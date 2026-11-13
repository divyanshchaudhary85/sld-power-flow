import { useCallback, useEffect, useRef, useState } from "react";
import {
  attachSolution,
  computeInputHash,
  confirmReview,
  isReviewCurrent,
  parseStudyDocument,
} from "./model";
import type { Finding, StudyDocument } from "./model";
import { BrowserSolverAdapter } from "./solver/client";
import type { RuntimeInfo, SolverAdapter } from "./solver/client";
import type { RuntimeProgress } from "./solver/runtime.mjs";
import { loadOpenCase, saveOpenCase } from "./storage";
import { validateNetwork } from "./validation";
import { captureBase } from "./operations";
import type { NativeReference } from "./proof";

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** Imported approvals and base snapshots are assertions from a file, not this session's review. */
export function unreviewedImport(document: StudyDocument): StudyDocument {
  const next = structuredClone(document);
  next.solution = null;
  next.validation = null;
  next.operation.base_snapshot = null;
  next.review = {
    ...next.review,
    status: "pending",
    confirmed_at: null,
    confirmed_input_hash: null,
    confirmed_model_revision: null,
  };
  return next;
}

export async function validatedDocument(
  document: StudyDocument,
  extra: Finding[] = [],
): Promise<StudyDocument> {
  const next = structuredClone(document),
    at = new Date().toISOString();
  const findings = [
    ...new Map(
      [
        ...validateNetwork(next),
        ...extra.filter((finding) => finding.model_revision === next.revision),
      ].map((finding) => [finding.id, finding]),
    ).values(),
  ];
  next.validation = {
    id: crypto.randomUUID(),
    model_revision: next.revision,
    input_hash: await computeInputHash(next),
    ruleset_version: "1.0.0",
    started_at: at,
    ended_at: new Date().toISOString(),
    findings,
    passed_pre_solve: !findings.some((finding) => finding.blocks_solve),
    solver_diagnostics_version: findings.some(
      (finding) => finding.stage === "solver_diagnostic",
    )
      ? "pandapower-3.3.3"
      : null,
  };
  return next;
}

interface WorkspaceSolveOptions {
  document: StudyDocument;
  adapter: Pick<SolverAdapter, "solve">;
  isCurrent: () => boolean;
  commit: (document: StudyDocument) => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onElapsed: (elapsed: number) => void;
  start?: number;
  now?: () => number;
  waitForPaint?: () => Promise<void>;
}

/** The hook and tests share this transaction. Every asynchronous boundary rechecks its owner. */
export async function runWorkspaceSolve(
  options: WorkspaceSolveOptions,
): Promise<void> {
  const { adapter, isCurrent, commit, onBusy, onError, onElapsed } = options;
  if (!isCurrent()) return;
  const now = options.now ?? (() => performance.now()),
    start = options.start ?? now();
  const waitForPaint =
    options.waitForPaint ??
    (() =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ));
  onBusy(true);
  onError("");
  let snapshot = structuredClone(options.document);
  // A pending or failed request must never keep the preceding run's numbers current.
  snapshot.solution = null;
  commit(snapshot);
  try {
    snapshot = await validatedDocument(snapshot);
    if (!isCurrent()) return;
    commit(snapshot);
    const blockers = snapshot.validation!.findings.filter(
      (finding) => finding.blocks_solve,
    );
    if (blockers.length)
      throw new Error(
        `${blockers.length} blocking finding(s). Open Validate or Complete data to resolve them.`,
      );
    const reviewed = await isReviewCurrent(snapshot);
    if (!isCurrent()) return;
    if (!reviewed)
      throw new Error("Review and confirm this exact case before solving.");
    if (!snapshot.operation.base_snapshot) {
      snapshot = await captureBase(snapshot);
      if (!isCurrent()) return;
      commit(snapshot);
    }
    const run = await adapter.solve(snapshot);
    if (!isCurrent()) return;
    let solved = await attachSolution(snapshot, run);
    if (!isCurrent()) return;
    const findings = validateNetwork(solved);
    solved.validation = {
      ...snapshot.validation!,
      findings,
      passed_pre_solve: !findings.some((finding) => finding.blocks_solve),
    };
    solved.operation.events.push({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      kind: "solve",
      selected_element_ids: [],
      changes: [],
      previous_revision: solved.revision,
      new_revision: solved.revision,
      solver_run_id: run.id,
      outcome: run.status === "converged" ? "succeeded" : "failed",
      message: `${run.status} · ${run.iterations ?? "—"} iterations`,
    });
    commit(solved);
    await waitForPaint();
    if (!isCurrent()) return;
    const total = Math.max(0, now() - start);
    if (run.timing) {
      solved = structuredClone(solved);
      solved.solution!.timing = {
        ...run.timing,
        total_ms: total,
        redraw_ms: Math.max(0, total - run.timing.total_ms),
        measurement_environment:
          "Browser UI action to two animation frames after results committed",
      };
      commit(solved);
    }
    onElapsed(total);
  } catch (error) {
    if (isCurrent()) onError(errorMessage(error, "Study failed."));
  } finally {
    if (isCurrent()) onBusy(false);
  }
}

export function useWorkspace() {
  const [doc, setDoc] = useState<StudyDocument | null>(null),
    ref = useRef<StudyDocument | null>(null);
  const [reference, setReference] = useState<NativeReference | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null),
    [progress, setProgress] = useState<RuntimeProgress | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("Local storage"),
    [elapsed, setElapsed] = useState<number | null>(null);
  const sequence = useRef(0),
    solveSequence = useRef(0),
    runtimeSequence = useRef(0),
    saveSequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [adapter] = useState(
    () =>
      new BrowserSolverAdapter({
        runtimeBaseURL: new URL(asset("runtime/"), location.origin).href,
      }),
  );
  const replace = useCallback(
    (next: StudyDocument, keepReference = false) => {
      ++sequence.current;
      ++solveSequence.current;
      adapter.invalidate();
      ref.current = next;
      setDoc(next);
      setBusy(false);
      setLoading(false);
      setError("");
      setElapsed(null);
      if (!keepReference) setReference(null);
    },
    [adapter],
  );
  const initialize = useCallback(async () => {
    const ticket = ++runtimeSequence.current;
    try {
      setError("");
      const info = await adapter.initialize((value) => {
        if (ticket === runtimeSequence.current) setProgress(value);
      });
      if (ticket === runtimeSequence.current) setRuntime(info);
    } catch (failure) {
      if (ticket === runtimeSequence.current) {
        setError(errorMessage(failure, "Could not load engine."));
        setRuntime(null);
      }
    }
  }, [adapter]);
  const loadSample = useCallback(
    async (id: string) => {
      const ticket = ++sequence.current;
      ++solveSequence.current;
      setLoading(true);
      setBusy(false);
      setError("");
      adapter.invalidate();
      try {
        const response = await fetch(asset(`fixtures/${id}.json`));
        if (!response.ok) throw new Error(`Could not load ${id}.`);
        let next = await confirmReview(
          parseStudyDocument(await response.text()),
        );
        next = await captureBase(next);
        const responseReference = await fetch(
          asset(`fixtures/${id}-reference.json`),
        );
        const native = responseReference.ok
          ? ((await responseReference.json()) as NativeReference)
          : null;
        if (ticket !== sequence.current) return;
        replace(next, true);
        setReference(native);
      } catch (failure) {
        if (ticket === sequence.current)
          setError(errorMessage(failure, "Case could not load."));
      } finally {
        if (ticket === sequence.current) setLoading(false);
      }
    },
    [adapter, replace],
  );
  const shutdown = useCallback(() => {
    ++sequence.current;
    ++solveSequence.current;
    ++runtimeSequence.current;
    ++saveSequence.current;
    adapter.dispose();
  }, [adapter]);
  useEffect(() => {
    void initialize();
    return shutdown;
  }, [initialize, shutdown]);
  useEffect(() => {
    let active = true;
    const ticket = sequence.current;
    void (async () => {
      try {
        const saved = await loadOpenCase();
        if (!active || ticket !== sequence.current) return;
        if (!saved) {
          void loadSample("case9");
          return;
        }
        const reviewed = await isReviewCurrent(saved);
        const hash = await computeInputHash(saved);
        if (!active || ticket !== sequence.current) return;
        if (!reviewed)
          saved.review = {
            ...saved.review,
            status: "pending",
            confirmed_at: null,
            confirmed_input_hash: null,
            confirmed_model_revision: null,
          };
        if (
          !reviewed ||
          (saved.solution &&
            (saved.solution.input_hash !== hash ||
              saved.solution.model_revision !== saved.revision))
        )
          saved.solution = null;
        replace(saved);
        setSaveStatus("Restored from this browser");
      } catch {
        if (active && ticket === sequence.current) void loadSample("case9");
      }
    })();
    return () => {
      active = false;
    };
  }, [loadSample, replace]);
  useEffect(() => {
    if (!doc) return;
    const ticket = ++saveSequence.current;
    const timer = setTimeout(() => {
      // IndexedDB writes are serialized; an older slow save cannot finish after a newer one.
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          if (ticket !== saveSequence.current) return;
          try {
            await saveOpenCase(doc);
            if (ticket === saveSequence.current)
              setSaveStatus("Saved in this browser");
          } catch {
            if (ticket === saveSequence.current)
              setSaveStatus("Storage unavailable — download your case");
          }
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [doc]);
  const importCase = useCallback(
    async (file: File) => {
      const ticket = ++sequence.current;
      ++solveSequence.current;
      setLoading(true);
      setBusy(false);
      setError("");
      adapter.invalidate();
      try {
        if (file.size > 20 * 1024 * 1024)
          throw new Error("Canonical case limit is 20 MB.");
        const next = unreviewedImport(parseStudyDocument(await file.text()));
        if (ticket !== sequence.current) return;
        replace(next);
      } catch (failure) {
        if (ticket === sequence.current)
          setError(errorMessage(failure, "Invalid case."));
      } finally {
        if (ticket === sequence.current) setLoading(false);
      }
    },
    [adapter, replace],
  );
  const validate = useCallback(
    async (target = ref.current, extra: Finding[] = []) => {
      if (!target || target !== ref.current) return null;
      const ticket = ++solveSequence.current;
      adapter.invalidate();
      setBusy(false);
      const next = await validatedDocument(target, extra);
      if (ticket !== solveSequence.current || ref.current !== target)
        return null;
      ref.current = next;
      setDoc(next);
      return next;
    },
    [adapter],
  );
  const solve = useCallback(
    async (target = ref.current, start = performance.now()) => {
      if (!target || target !== ref.current) return;
      const ticket = ++solveSequence.current;
      adapter.invalidate();
      setElapsed(null);
      await runWorkspaceSolve({
        document: target,
        adapter,
        start,
        isCurrent: () => ticket === solveSequence.current,
        commit: (next) => {
          ref.current = next;
          setDoc(next);
        },
        onBusy: setBusy,
        onError: setError,
        onElapsed: setElapsed,
      });
    },
    [adapter],
  );
  return {
    doc,
    ref,
    replace,
    reference,
    runtime,
    progress,
    busy,
    loading,
    error,
    setError,
    saveStatus,
    elapsed,
    adapter,
    initialize,
    loadSample,
    importCase,
    validate,
    solve,
    setRuntime,
  };
}
