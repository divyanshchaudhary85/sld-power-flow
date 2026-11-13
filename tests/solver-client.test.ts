import { describe, expect, it, vi } from "vitest";
import template from "../schema/fixture-template.json";
import type { SolutionRun, StudyDocument } from "../src/model/types";
import { confirmReview } from "../src/model/revision";
import { BrowserSolverAdapter } from "../src/solver/client";
import type { SolverRequest, SolverResponse } from "../src/solver/protocol";

class ControlledWorker {
  onmessage: ((event: MessageEvent<SolverResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: SolverRequest[] = [];
  terminated = false;
  postMessage(request: SolverRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  send(data: SolverResponse) {
    this.onmessage?.({ data } as MessageEvent<SolverResponse>);
  }
  ready() {
    const request = this.requests.find((r) => r.type === "initialize");
    if (!request) throw new Error("No initialization requested.");
    this.send({
      type: "ready",
      requestId: request.requestId,
      loadMs: 12,
      solverVersion: "3.3.3",
      runtimeVersion: "0.29.3",
      packageLockDigest: "test-lock",
    });
  }
}
function harness() {
  const workers: ControlledWorker[] = [];
  const adapter = new BrowserSolverAdapter({
    runtimeBaseURL: "https://example.test/app/runtime/",
    createWorker: () => {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
  return { adapter, workers };
}
async function doc() {
  return confirmReview(structuredClone(template) as StudyDocument);
}
function protocolResult(
  request: Extract<SolverRequest, { type: "solve" }>,
): SolutionRun {
  // This test double checks transport freshness only; the real numerical proof is runtime.proof.mjs.
  return {
    id: "transport-test",
    model_revision: request.document.revision,
    input_hash: request.inputHash,
  } as SolutionRun;
}

describe("solver Worker lifecycle and result freshness", () => {
  it("shares one initialization and forwards named progress", async () => {
    const { adapter, workers } = harness();
    const progress = vi.fn();
    const first = adapter.initialize(progress);
    const second = adapter.initialize();
    expect(first).toBe(second);
    const request = workers[0].requests[0];
    workers[0].send({
      type: "progress",
      requestId: request.requestId,
      progress: {
        stage: "loading-packages",
        message: "Loading numerical libraries",
      },
    });
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "loading-packages" }),
    );
    workers[0].ready();
    expect((await first).solverVersion).toBe("3.3.3");
    adapter.dispose();
  });

  it("cancels CPU work by termination and safely initializes a replacement", async () => {
    const { adapter, workers } = harness();
    const first = adapter.initialize();
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    adapter.cancel();
    const progress = vi.fn();
    const replacement = adapter.initialize(progress);
    await rejected;
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    workers[1].send({
      type: "progress",
      requestId: workers[1].requests[0].requestId,
      progress: { stage: "loading-python", message: "Reloading Python" },
    });
    expect(progress).toHaveBeenCalledOnce();
    workers[1].ready();
    expect((await replacement).runtimeVersion).toBe("0.29.3");
    adapter.dispose();
  });

  it("discards an in-flight result immediately when the case changes", async () => {
    const { adapter, workers } = harness();
    const ready = adapter.initialize();
    workers[0].ready();
    await ready;
    const result = adapter.solve(await doc());
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() =>
      expect(workers[0].requests.some((r) => r.type === "solve")).toBe(true),
    );
    const request = workers[0].requests.find(
      (r) => r.type === "solve",
    ) as Extract<SolverRequest, { type: "solve" }>;
    adapter.invalidate();
    workers[0].send({
      type: "solution",
      requestId: request.requestId,
      revision: request.document.revision,
      inputHash: request.inputHash,
      solution: protocolResult(request),
      elapsedMs: 1,
    });
    await rejected;
    expect(workers[0].terminated).toBe(false);
    adapter.dispose();
  });

  it("rejects a response that contains the wrong input hash", async () => {
    const { adapter, workers } = harness();
    const ready = adapter.initialize();
    workers[0].ready();
    await ready;
    const result = adapter.solve(await doc());
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() =>
      expect(workers[0].requests.some((r) => r.type === "solve")).toBe(true),
    );
    const request = workers[0].requests.find(
      (r) => r.type === "solve",
    ) as Extract<SolverRequest, { type: "solve" }>;
    workers[0].send({
      type: "solution",
      requestId: request.requestId,
      revision: request.document.revision,
      inputHash: "a-different-case",
      solution: protocolResult(request),
      elapsedMs: 1,
    });
    await rejected;
    adapter.dispose();
  });

  it("aborts an active solve via AbortSignal", async () => {
    const { adapter, workers } = harness();
    const ready = adapter.initialize();
    workers[0].ready();
    await ready;
    const controller = new AbortController();
    const result = adapter.solve(await doc(), { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() =>
      expect(workers[0].requests.some((r) => r.type === "solve")).toBe(true),
    );
    controller.abort();
    await rejected;
    expect(workers[0].terminated).toBe(true);
    adapter.dispose();
  });

  it("blocks unreviewed inputs before loading or contacting the Worker", async () => {
    const { adapter, workers } = harness();
    await expect(
      adapter.solve(structuredClone(template) as StudyDocument),
    ).rejects.toThrow("Review and confirm");
    expect(workers).toHaveLength(0);
    adapter.dispose();
  });

  it("detects an input change even if its revision number was not incremented", async () => {
    const { adapter, workers } = harness();
    const document = await doc();
    document.settings.max_iterations = {
      status: "known",
      value: 31,
      derivation: null,
      provenance: {
        source: "user",
        changed_at: "2026-11-13T00:00:00Z",
        supersedes_path: null,
        evidence: [],
      },
    };
    await expect(adapter.solve(document)).rejects.toThrow(
      "inputs have changed",
    );
    expect(workers).toHaveLength(0);
    adapter.dispose();
  });

  it("replaces a failed bootstrap Worker when retrying", async () => {
    const { adapter, workers } = harness();
    const first = adapter.initialize();
    const rejected = expect(first).rejects.toThrow("missing asset");
    workers[0].send({
      type: "error",
      requestId: workers[0].requests[0].requestId,
      message: "missing asset",
    });
    await rejected;
    expect(workers[0].terminated).toBe(true);
    const retry = adapter.initialize();
    workers[1].ready();
    await expect(retry).resolves.toMatchObject({ solverVersion: "3.3.3" });
    adapter.dispose();
  });
});
