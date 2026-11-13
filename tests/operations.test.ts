import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CircuitBreaker, SolutionRun, StudyDocument } from "../src/model";
import {
  assertStudyDocument,
  computeInputHash,
  confirmReview,
  isReviewCurrent,
  userValue,
} from "../src/model";
import {
  baseDifferences,
  captureBase,
  operate,
  resetBase,
} from "../src/operations";
import { analyzeTopology, validateNetwork } from "../src/validation";
import { runWorkspaceSolve, unreviewedImport } from "../src/useWorkspace";

const at = "2026-11-13T00:00:00Z";
const fixture = (): StudyDocument =>
  JSON.parse(
    readFileSync(
      new URL("../public/fixtures/case9.json", import.meta.url),
      "utf8",
    ),
  );
const source = {
  kind: "synthetic" as const,
  fixture_id: "operator-tests",
  generated_drawing: null,
};
function addLoadBreaker(document: StudyDocument, loadIndex = 0, open = false) {
  const load = document.elements.filter(
    (element) => element.type.value === "load",
  )[loadIndex];
  const terminal = Object.values(load.terminals)[0];
  const oldPoint =
    terminal.connection_point.status === "known"
      ? terminal.connection_point.value
      : "";
  const point = `${load.id}-switched`,
    id = `${load.id}-breaker`;
  document.connectivity_points.push({
    id: point,
    kind: "junction",
    position: { x: 0, y: 0 },
    source_ref: source,
    evidence: [],
  });
  terminal.connection_point = userValue(point, at);
  const breaker = {
    ...structuredClone(load),
    id,
    type: userValue("circuit_breaker", at),
    source_ref: source,
    data: {
      state: userValue(open ? "open" : "closed", at),
      normal_state: userValue("closed", at),
      rated_current_ka: userValue(10, at),
      rated_voltage_kv: userValue(345, at),
      electrical_model: userValue("ideal", at),
    },
    terminals: Object.fromEntries(
      ["a", "b"].map((role, index) => [
        role,
        {
          id: `${id}:${role}`,
          role,
          connection_point: userValue(index ? point : oldPoint, at),
          source_ref: source,
          drawn_anchor: null,
        },
      ]),
    ),
  } as unknown as CircuitBreaker;
  document.elements.push(breaker);
  return {
    id,
    loadId: load.id,
    path: `/elements/${document.elements.length - 1}/data/state`,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 50 && !predicate(); i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  expect(predicate()).toBe(true);
}
async function failedRun(document: StudyDocument): Promise<SolutionRun> {
  return {
    id: crypto.randomUUID(),
    model_revision: document.revision,
    input_hash: await computeInputHash(document),
    requested_at: at,
    completed_at: at,
    status: "failed",
    iterations: null,
    timing: null,
    diagnostics: [],
    mappings: [],
    energized_point_ids: [],
    deenergized_point_ids: [],
    quality: {
      defaulted_input_paths: [],
      library_input_paths: [],
      user_input_paths: [],
      dependencies: [],
    },
    results: null,
    solver: {
      backend: "pandapower",
      backend_version: "3.3.3",
      runtime: "test",
      runtime_version: "test",
      package_lock_digest: "test",
      algorithm: "newton_raphson",
      tolerance_mva: 1e-8,
      max_iterations: 30,
      enforce_q_limits: false,
      transformer_equivalent: "t",
    },
  };
}

describe("reviewed operator transactions", () => {
  it("opens a breaker as an explicit outage and closes it without losing exact review", async () => {
    const original = fixture(),
      breaker = addLoadBreaker(original);
    const reviewed = await confirmReview(original);
    const opened = await operate(
      reviewed,
      breaker.id,
      breaker.path,
      "open",
      "switch",
      "Open breaker",
    );
    expect(opened.revision).toBe(reviewed.revision + 1);
    expect(await isReviewCurrent(opened)).toBe(true);
    expect(analyzeTopology(opened).deenergizedElementIds).toContain(
      breaker.loadId,
    );
    expect(
      opened.operation.island_policy.authorized_isolated_element_ids,
    ).toContain(breaker.loadId);
    expect(
      validateNetwork(opened)
        .filter((finding) => finding.rule_id === "T02")
        .every((finding) => !finding.blocks_solve),
    ).toBe(true);
    const closed = await operate(
      opened,
      breaker.id,
      breaker.path,
      "closed",
      "switch",
      "Close breaker",
    );
    expect(analyzeTopology(closed).energizedElementIds).toContain(
      breaker.loadId,
    );
    expect(closed.operation.island_policy.mode).toBe("preparation_strict");
    expect(await isReviewCurrent(closed)).toBe(true);
    expect(reviewed.elements.at(-1)?.data).not.toEqual(
      opened.elements.at(-1)?.data,
    );
    assertStudyDocument(closed);
  });
  it("does not authorize an unrelated pre-existing accidental island", async () => {
    const original = fixture(),
      accidental = addLoadBreaker(original, 0, true),
      deliberate = addLoadBreaker(original, 1);
    const opened = await operate(
      await confirmReview(original),
      deliberate.id,
      deliberate.path,
      "open",
      "switch",
      "Open second breaker",
    );
    expect(
      opened.operation.island_policy.authorized_isolated_element_ids,
    ).not.toContain(accidental.loadId);
    expect(
      validateNetwork(opened).some(
        (finding) => finding.rule_id === "T02" && finding.blocks_solve,
      ),
    ).toBe(true);
  });
  it("rejects stale review hashes and paths belonging to another selected device", async () => {
    const original = fixture(),
      breaker = addLoadBreaker(original),
      reviewed = await confirmReview(original);
    const tampered = structuredClone(reviewed);
    tampered.settings.max_iterations = userValue(31, at);
    await expect(
      operate(tampered, breaker.id, breaker.path, "open", "switch", "Open"),
    ).rejects.toThrow("exact reviewed");
    await expect(
      operate(
        reviewed,
        reviewed.elements[0].id,
        breaker.path,
        "open",
        "switch",
        "Open",
      ),
    ).rejects.toThrow("selected equipment");
  });
  it("captures, compares and resets a base without mutating the base or fabricating review", async () => {
    const original = fixture(),
      breaker = addLoadBreaker(original),
      base = await captureBase(await confirmReview(original));
    const opened = await operate(
      base,
      breaker.id,
      breaker.path,
      "open",
      "switch",
      "Open",
    );
    expect(baseDifferences(opened)).toEqual([
      expect.objectContaining({
        element: breaker.id,
        path: "data/state",
        before: '"closed"',
        after: '"open"',
      }),
    ]);
    const restored = await resetBase(opened);
    expect(baseDifferences(restored)).toEqual([]);
    expect(await isReviewCurrent(restored)).toBe(true);
    expect(analyzeTopology(restored).energizedElementIds).toContain(
      breaker.loadId,
    );
    expect(restored.operation.events.at(-1)?.kind).toBe("reset");
    expect(base.operation.base_snapshot).toEqual(
      opened.operation.base_snapshot,
    );
  });
  it("does not let an imported base bypass explicit review through Reset", async () => {
    const reviewed = await captureBase(await confirmReview(fixture()));
    const imported = unreviewedImport(reviewed);
    expect(imported.review.status).toBe("pending");
    expect(imported.operation.base_snapshot).toBeNull();
    expect(await isReviewCurrent(imported)).toBe(false);
    await expect(resetBase(imported)).rejects.toThrow("No base case");
    expect(reviewed.operation.base_snapshot).not.toBeNull();
  });
  it("restores separately confirmed island slacks with the captured base", async () => {
    const document = fixture();
    const generator = structuredClone(
      document.elements.find((element) => element.type.value === "generator")!,
    );
    const bus = structuredClone(
      document.elements.find((element) => element.type.value === "busbar")!,
    );
    for (const element of [generator, bus]) {
      element.id += "-separate";
      for (const terminal of Object.values(element.terminals)) {
        terminal.id += "-separate";
        terminal.connection_point = userValue("separate", at);
      }
    }
    (generator.data as unknown as Record<string, unknown>).mode = userValue(
      "slack",
      at,
    );
    document.elements.push(generator, bus);
    document.connectivity_points.push({
      id: "separate",
      kind: "junction",
      position: { x: 0, y: 0 },
      source_ref: source,
      evidence: [],
    });
    document.operation.island_policy.energized_island_slacks = [
      { connectivity_point_ids: ["separate"], slack_element_id: generator.id },
    ];
    const base = await captureBase(await confirmReview(document));
    const changed = structuredClone(base);
    changed.operation.island_policy.energized_island_slacks = [];
    const reset = await resetBase(changed);
    expect(reset.operation.island_policy.energized_island_slacks).toEqual(
      base.operation.island_policy.energized_island_slacks,
    );
    expect(analyzeTopology(reset).energizedElementIds).toContain(generator.id);
    expect(await isReviewCurrent(reset)).toBe(true);
  });
});

describe("workspace solve transaction", () => {
  it("abandons async preparation after the case is replaced", async () => {
    const document = await confirmReview(fixture());
    let current = true,
      calls = 0;
    const commits: StudyDocument[] = [],
      busy: boolean[] = [],
      errors: string[] = [];
    const task = runWorkspaceSolve({
      document,
      adapter: {
        solve: async (input) => {
          calls++;
          return failedRun(input);
        },
      },
      isCurrent: () => current,
      commit: (next) => commits.push(next),
      onBusy: (value) => busy.push(value),
      onError: (value) => errors.push(value),
      onElapsed: () => {},
      waitForPaint: async () => {},
    });
    current = false;
    await task;
    expect(calls).toBe(0);
    expect(commits).toHaveLength(1);
    expect(busy).toEqual([true]);
    expect(errors).toEqual([""]);
  });
  it("does not let an older failed solve clear a newer busy state or error", async () => {
    const document = await confirmReview(fixture());
    let generation = 1;
    const pending = [deferred<SolutionRun>(), deferred<SolutionRun>()],
      inputs: StudyDocument[] = [],
      busy: boolean[] = [],
      errors: string[] = [],
      commits: StudyDocument[] = [];
    const adapter = {
      solve: (input: StudyDocument) => {
        inputs.push(input);
        return pending[inputs.length - 1].promise;
      },
    };
    const launch = (ticket: number) =>
      runWorkspaceSolve({
        document,
        adapter,
        isCurrent: () => generation === ticket,
        commit: (next) => commits.push(next),
        onBusy: (value) => busy.push(value),
        onError: (value) => errors.push(value),
        onElapsed: () => {},
        waitForPaint: async () => {},
      });
    const first = launch(1);
    await until(() => inputs.length === 1);
    generation = 2;
    const second = launch(2);
    await until(() => inputs.length === 2);
    const count = commits.length;
    pending[0].reject(new Error("obsolete failure"));
    await first;
    expect(commits).toHaveLength(count);
    expect(busy).toEqual([true, true]);
    expect(errors).toEqual(["", ""]);
    pending[1].resolve(await failedRun(inputs[1]));
    await second;
    expect(busy).toEqual([true, true, false]);
    expect(commits.at(-1)?.solution?.status).toBe("failed");
    assertStudyDocument(commits.at(-1));
  });
  it("does not attach a successful completion from an abandoned case", async () => {
    const document = await confirmReview(fixture());
    let current = true;
    const pending = deferred<SolutionRun>();
    let input: StudyDocument | null = null;
    const commits: StudyDocument[] = [];
    const task = runWorkspaceSolve({
      document,
      adapter: {
        solve: async (next) => {
          input = next;
          return pending.promise;
        },
      },
      isCurrent: () => current,
      commit: (next) => commits.push(next),
      onBusy: () => {},
      onError: () => {},
      onElapsed: () => {},
      waitForPaint: async () => {},
    });
    await until(() => input !== null);
    current = false;
    const count = commits.length;
    pending.resolve(await failedRun(input!));
    await task;
    expect(commits).toHaveLength(count);
    expect(commits.every((next) => !next.solution)).toBe(true);
  });
  it("requires the exact review hash and leaves blocking findings available", async () => {
    const document = await confirmReview(fixture());
    document.settings.max_iterations = userValue(33, at);
    let calls = 0;
    const errors: string[] = [],
      commits: StudyDocument[] = [];
    await runWorkspaceSolve({
      document,
      adapter: {
        solve: async (input) => {
          calls++;
          return failedRun(input);
        },
      },
      isCurrent: () => true,
      commit: (next) => commits.push(next),
      onBusy: () => {},
      onError: (value) => errors.push(value),
      onElapsed: () => {},
      waitForPaint: async () => {},
    });
    expect(calls).toBe(0);
    expect(errors.at(-1)).toContain("exact case");
    expect(commits.at(-1)?.validation).not.toBeNull();
  });
  it("rejects mismatched result hashes and suppresses post-paint writes after replacement", async () => {
    const document = await confirmReview(fixture());
    const errors: string[] = [],
      commits: StudyDocument[] = [];
    await runWorkspaceSolve({
      document,
      adapter: {
        solve: async (input) => ({
          ...(await failedRun(input)),
          input_hash: "wrong",
        }),
      },
      isCurrent: () => true,
      commit: (next) => commits.push(next),
      onBusy: () => {},
      onError: (value) => errors.push(value),
      onElapsed: () => {},
      waitForPaint: async () => {},
    });
    expect(errors.at(-1)).toContain("input hash");
    expect(commits.every((next) => !next.solution)).toBe(true);
    let current = true,
      elapsed = false;
    const paint = deferred<void>();
    let reachedPaint = false;
    const task = runWorkspaceSolve({
      document,
      adapter: { solve: failedRun },
      isCurrent: () => current,
      commit: (next) => commits.push(next),
      onBusy: () => {},
      onError: () => {},
      onElapsed: () => {
        elapsed = true;
      },
      waitForPaint: () => {
        reachedPaint = true;
        return paint.promise;
      },
    });
    await until(() => reachedPaint);
    current = false;
    const count = commits.length;
    paint.resolve();
    await task;
    expect(commits).toHaveLength(count);
    expect(elapsed).toBe(false);
  });
});
