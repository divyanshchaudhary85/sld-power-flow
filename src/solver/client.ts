import { computeInputHash } from "../model/revision";
import { assertStudyDocument } from "../model/validation";
import type { Finding, SolutionRun, StudyDocument } from "../model/types";
import type { RuntimeProgress } from "./runtime.mjs";
import type {
  CaseFormat,
  CaseExport,
  SolverRequest,
  SolverResponse,
} from "./protocol";

export interface RuntimeInfo {
  loadMs: number;
  solverVersion: string;
  runtimeVersion: string;
  packageLockDigest: string;
}
export interface SolverAdapter {
  initialize(
    onProgress?: (progress: RuntimeProgress) => void,
  ): Promise<RuntimeInfo>;
  solve(
    document: StudyDocument,
    options?: { signal?: AbortSignal },
  ): Promise<SolutionRun>;
  exportCase(document: StudyDocument, format: CaseFormat): Promise<CaseExport>;
  diagnose(document: StudyDocument): Promise<Finding[]>;
  invalidate(): void;
  cancel(): void;
  dispose(): void;
}
interface Pending {
  resolve: (response: SolverResponse) => void;
  reject: (error: Error) => void;
  kind: SolverRequest["type"];
}
export class SolverCancelledError extends Error {
  constructor(
    message = "The solver operation was cancelled. Reloading the runtime is required before the next solve.",
  ) {
    super(message);
    this.name = "AbortError";
  }
}

/** Worker termination provides immediate cancellation without cross-origin isolation. */
export class BrowserSolverAdapter implements SolverAdapter {
  private worker: Worker | null = null;
  private initialization: Promise<RuntimeInfo> | null = null;
  private info: RuntimeInfo | null = null;
  private pending = new Map<string, Pending>();
  private progressListeners = new Set<(progress: RuntimeProgress) => void>();
  private generation = 0;
  private epoch = 0;
  private disposed = false;
  private readonly runtimeBaseURL: string;
  private readonly createWorker: () => Worker;

  constructor(options: {
    runtimeBaseURL: string;
    createWorker?: () => Worker;
  }) {
    this.runtimeBaseURL = options.runtimeBaseURL;
    this.createWorker =
      options.createWorker ??
      (() =>
        new Worker(new URL("./solver.worker.ts", import.meta.url), {
          type: "module",
        }));
  }

  initialize(
    onProgress?: (progress: RuntimeProgress) => void,
  ): Promise<RuntimeInfo> {
    if (this.disposed)
      return Promise.reject(
        new Error("This solver adapter has been disposed."),
      );
    if (this.info) return Promise.resolve(this.info);
    if (onProgress) this.progressListeners.add(onProgress);
    if (!this.initialization) {
      this.ensureWorker();
      const epoch = this.epoch;
      const initialization = this.request({
        type: "initialize",
        requestId: crypto.randomUUID(),
        runtimeBaseURL: this.runtimeBaseURL,
      })
        .then((response) => {
          if (this.epoch !== epoch) throw new SolverCancelledError();
          if (response.type !== "ready")
            throw new Error("Unexpected solver initialization response.");
          this.info = {
            loadMs: response.loadMs,
            solverVersion: response.solverVersion,
            runtimeVersion: response.runtimeVersion,
            packageLockDigest: response.packageLockDigest,
          };
          return this.info;
        })
        .catch((error) => {
          if (this.initialization === initialization) {
            this.initialization = null;
            this.progressListeners.clear();
          }
          throw error;
        })
        .finally(() => {
          if (this.initialization === initialization)
            this.progressListeners.clear();
        });
      this.initialization = initialization;
    }
    return this.initialization;
  }

  async solve(
    document: StudyDocument,
    options: { signal?: AbortSignal } = {},
  ): Promise<SolutionRun> {
    assertStudyDocument(document);
    if (options.signal?.aborted) throw new SolverCancelledError();
    // Snapshot before any await: callers may continue editing their current case.
    const snapshot = structuredClone(document);
    const generation = ++this.generation;
    this.rejectSolves(
      new SolverCancelledError("A newer study superseded this solver request."),
    );
    const abort = () => this.cancel();
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const inputHash = await computeInputHash(snapshot);
      if (
        snapshot.review.status !== "confirmed" ||
        snapshot.review.confirmed_model_revision !== snapshot.revision ||
        snapshot.review.confirmed_input_hash !== inputHash
      ) {
        throw new Error(
          "Review and confirm this exact case before solving. The inputs have changed or have not been reviewed.",
        );
      }
      if (options.signal?.aborted || generation !== this.generation)
        throw new SolverCancelledError();
      await this.initialize();
      if (options.signal?.aborted || generation !== this.generation)
        throw new SolverCancelledError();
      const response = await this.request({
        type: "solve",
        requestId: crypto.randomUUID(),
        document: snapshot,
        inputHash,
      });
      if (response.type !== "solution")
        throw new Error("Unexpected solver response.");
      if (
        generation !== this.generation ||
        response.revision !== snapshot.revision ||
        response.inputHash !== inputHash ||
        response.solution.model_revision !== snapshot.revision ||
        response.solution.input_hash !== inputHash
      ) {
        throw new SolverCancelledError(
          "The solver result belongs to an earlier revision and was discarded.",
        );
      }
      // The caller must attachSolution(currentDocument, run) to check edits made while this promise ran.
      return response.solution;
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }

  /** Called immediately when engineering data changes; leaves the warm Worker available. */
  async exportCase(
    document: StudyDocument,
    format: CaseFormat,
  ): Promise<CaseExport> {
    assertStudyDocument(document);
    const snapshot = structuredClone(document);
    const generation = this.generation;
    const inputHash = await computeInputHash(snapshot);
    if (
      snapshot.review.status !== "confirmed" ||
      snapshot.review.confirmed_input_hash !== inputHash
    )
      throw new Error("Review the current case before export.");
    await this.initialize();
    const response = await this.request({
      type: "export",
      requestId: crypto.randomUUID(),
      document: snapshot,
      inputHash,
      format,
    });
    if (generation !== this.generation)
      throw new SolverCancelledError("The case changed during export.");
    if (response.type !== "exported")
      throw new Error("Unexpected export response.");
    return response.result;
  }
  async diagnose(document: StudyDocument): Promise<Finding[]> {
    assertStudyDocument(document);
    const snapshot = structuredClone(document);
    const generation = this.generation;
    const inputHash = await computeInputHash(snapshot);
    await this.initialize();
    const response = await this.request({
      type: "diagnose",
      requestId: crypto.randomUUID(),
      document: snapshot,
      inputHash,
    });
    if (generation !== this.generation)
      throw new SolverCancelledError("The case changed during diagnostics.");
    if (response.type !== "diagnostics")
      throw new Error("Unexpected diagnostics response.");
    return response.findings;
  }
  invalidate(): void {
    this.generation++;
    this.rejectSolves(
      new SolverCancelledError(
        "Engineering data changed; the pending result was discarded.",
      ),
    );
  }

  cancel(): void {
    this.generation++;
    this.epoch++;
    this.worker?.terminate();
    this.worker = null;
    this.info = null;
    this.initialization = null;
    for (const pending of this.pending.values())
      pending.reject(new SolverCancelledError());
    this.pending.clear();
    this.progressListeners.clear();
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }

  private rejectSolves(error: Error): void {
    for (const [id, pending] of this.pending)
      if (pending.kind !== "initialize") {
        this.pending.delete(id);
        pending.reject(error);
      }
  }

  private ensureWorker(): void {
    if (this.worker) return;
    const worker = this.createWorker();
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      // Messages already in the browser queue from a terminated Worker cannot revive it.
      if (this.worker !== worker) return;
      const response = event.data;
      if (response.type === "progress") {
        if (this.pending.has(response.requestId))
          for (const listener of this.progressListeners)
            listener(response.progress);
        return;
      }
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      if (response.type === "error") {
        if (pending.kind === "initialize") {
          worker.terminate();
          this.worker = null;
          this.info = null;
        }
        pending.reject(new Error(response.message));
      } else pending.resolve(response);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      const error = new Error(
        event.message || "The solver worker stopped unexpectedly.",
      );
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      worker.terminate();
      this.worker = null;
      this.initialization = null;
      this.info = null;
    };
  }

  private request(request: SolverRequest): Promise<SolverResponse> {
    if (!this.worker)
      return Promise.reject(new Error("The solver worker is not available."));
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve,
        reject,
        kind: request.type,
      });
      this.worker?.postMessage(request);
    });
  }
}
