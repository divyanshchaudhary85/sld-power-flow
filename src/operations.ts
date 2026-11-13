import {
  commitEngineeringEdit,
  confirmReview,
  computeInputHash,
  isReviewCurrent,
  getAtPath,
  replaceAtPath,
} from "./model";
import type { StudyDocument, Event, JsonValue } from "./model";
import { analyzeTopology, validateNetwork } from "./validation";

export function setPath(object: unknown, path: string, value: unknown) {
  replaceAtPath(object, path, value);
}

/** A confirmed operation changes one selected device; it cannot silently approve an unrelated outage. */
export async function operate(
  document: StudyDocument,
  elementId: string,
  path: string,
  value: unknown,
  kind: Event["kind"],
  message: string,
): Promise<StudyDocument> {
  const original = structuredClone(document);
  if (!(await isReviewCurrent(original)))
    throw new Error(
      "Confirm the exact reviewed inputs before operator actions.",
    );
  const index = original.elements.findIndex(
    (element) => element.id === elementId,
  );
  if (index < 0)
    throw new Error("Select an existing element before operating it.");
  const element = original.elements[index],
    prefix = `/elements/${index}`;
  const allowed =
    kind === "switch"
      ? path === `${prefix}/data/state` &&
        ["open", "closed"].includes(String(value)) &&
        ["circuit_breaker", "disconnector", "fuse"].includes(element.type.value)
      : kind === "service"
        ? path === `${prefix}/in_service` && typeof value === "boolean"
        : kind === "tap"
          ? path === `${prefix}/data/tap/value/position` &&
            element.type.value === "transformer_2w" &&
            typeof value === "number" &&
            Number.isInteger(value)
          : kind === "setpoint"
            ? ["p_mw", "q_mvar", "voltage_setpoint_kv", "scaling_factor"].some(
                (key) => path === `${prefix}/data/${key}`,
              ) &&
              typeof value === "number" &&
              Number.isFinite(value)
            : false;
  if (!allowed)
    throw new Error(
      "This operation does not match the selected equipment and action.",
    );
  const time = new Date().toISOString(),
    id = crypto.randomUUID(),
    before = getAtPath(original, path);
  const previousTopology = analyzeTopology(original);
  const next = commitEngineeringEdit(
    original,
    (draft) => {
      setPath(draft, path, {
        status: "known",
        value,
        provenance: {
          source: "user",
          changed_at: time,
          supersedes_path: path,
          evidence: [],
        },
        derivation: null,
      });
      draft.operation.events.push({
        id,
        time,
        kind,
        selected_element_ids: [elementId],
        changes: [
          {
            path,
            before: before as JsonValue,
            after: getAtPath(draft, path) as JsonValue,
          },
        ],
        previous_revision: original.revision,
        new_revision: original.revision + 1,
        solver_run_id: null,
        outcome: "confirmed",
        message,
      });
    },
    time,
  );
  if (kind === "switch" || kind === "service") {
    const topology = analyzeTopology(next),
      alreadyDead = new Set(previousTopology.deenergizedElementIds);
    const dead = new Set(topology.deenergizedElementIds);
    const priorPolicy = original.operation.island_policy;
    const oldEventIds = new Set(
      original.operation.events.map((event) => event.id),
    );
    const priorValid =
      priorPolicy.mode === "intentional_outage" &&
      priorPolicy.authorizing_event_ids.length > 0 &&
      priorPolicy.authorizing_event_ids.every((eventId) =>
        oldEventIds.has(eventId),
      );
    const authorized = new Set(
      priorValid
        ? priorPolicy.authorized_isolated_element_ids.filter((id) =>
            dead.has(id),
          )
        : [],
    );
    topology.deenergizedElementIds
      .filter((id) => !alreadyDead.has(id))
      .forEach((id) => authorized.add(id));
    next.operation.island_policy = {
      ...priorPolicy,
      mode: authorized.size ? "intentional_outage" : "preparation_strict",
      authorized_isolated_element_ids: [...authorized],
      authorizing_event_ids: authorized.size
        ? [...(priorValid ? priorPolicy.authorizing_event_ids : []), id]
        : [],
    };
  }
  return confirmReview(next, time);
}

export async function captureBase(
  document: StudyDocument,
): Promise<StudyDocument> {
  const next = structuredClone(document);
  if (!(await isReviewCurrent(next)))
    throw new Error("Review the exact inputs before capturing a base case.");
  if (validateNetwork(next).some((finding) => finding.blocks_solve))
    throw new Error("Resolve blocking findings before capturing a base case.");
  next.operation.base_snapshot = {
    revision: next.revision,
    input_hash: await computeInputHash(next),
    meta: structuredClone(next.meta),
    settings: structuredClone(next.settings),
    elements: structuredClone(next.elements),
    connectivity_points: structuredClone(next.connectivity_points),
  };
  // The fixed snapshot schema stores equipment, while the event records its reviewed operating policy.
  next.operation.events.push({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    kind: "compare",
    selected_element_ids: [],
    changes: [
      {
        path: "/operation/island_policy",
        before: structuredClone(next.operation.island_policy),
        after: structuredClone(next.operation.island_policy),
      },
    ],
    previous_revision: next.revision,
    new_revision: next.revision,
    solver_run_id: null,
    outcome: "confirmed",
    message: `Captured base case ${next.operation.base_snapshot.input_hash}`,
  });
  return next;
}

export async function resetBase(
  document: StudyDocument,
): Promise<StudyDocument> {
  const original = structuredClone(document),
    base = original.operation.base_snapshot;
  if (!base) throw new Error("No base case has been captured.");
  const time = new Date().toISOString(),
    id = crypto.randomUUID();
  const baseEvent = [...original.operation.events]
    .reverse()
    .find(
      (event) =>
        event.kind === "compare" &&
        event.message === `Captured base case ${base.input_hash}`,
    );
  const savedPolicy = baseEvent?.changes.find(
    (change) => change.path === "/operation/island_policy",
  )?.after;
  const next = commitEngineeringEdit(
    original,
    (draft) => {
      draft.meta = structuredClone(base.meta);
      draft.settings = structuredClone(base.settings);
      draft.elements = structuredClone(base.elements);
      draft.connectivity_points = structuredClone(base.connectivity_points);
      draft.data_suggestions = [];
      draft.review.unresolved_element_ids = [];
      draft.operation.island_policy = savedPolicy
        ? (structuredClone(
            savedPolicy,
          ) as StudyDocument["operation"]["island_policy"])
        : {
            mode: "preparation_strict",
            authorized_isolated_element_ids: [],
            authorizing_event_ids: [],
            energized_island_slacks: [],
          };
      draft.operation.events.push({
        id,
        time,
        kind: "reset",
        selected_element_ids: [],
        changes: [],
        previous_revision: original.revision,
        new_revision: original.revision + 1,
        solver_run_id: null,
        outcome: "confirmed",
        message: "Reset to the captured base case",
      });
    },
    time,
  );
  // Restoring a reviewed base is an explicit action, including any outages present in that base.
  const topology = analyzeTopology(next);
  if (topology.deenergizedElementIds.length)
    next.operation.island_policy = {
      ...next.operation.island_policy,
      mode: "intentional_outage",
      authorized_isolated_element_ids: topology.deenergizedElementIds,
      authorizing_event_ids: [id],
    };
  return confirmReview(next, time);
}

export function baseDifferences(
  document: StudyDocument,
): { element: string; path: string; before: string; after: string }[] {
  const base = document.operation.base_snapshot;
  if (!base) return [];
  const changes: {
    element: string;
    path: string;
    before: string;
    after: string;
  }[] = [];
  const clean = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if ("status" in value && value.status === "missing") return "[missing]";
    if ("status" in value && value.status === "known" && "value" in value)
      return clean(value.value);
    if (Array.isArray(value)) return value.map(clean);
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, clean(entry)]),
    );
  };
  const walk = (
    before: unknown,
    after: unknown,
    path: string,
    element: string,
  ) => {
    if (JSON.stringify(clean(before)) === JSON.stringify(clean(after))) return;
    if (
      before &&
      after &&
      typeof before === "object" &&
      typeof after === "object" &&
      !("status" in before) &&
      !("status" in after)
    ) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of keys)
        walk(
          (before as Record<string, unknown>)[key],
          (after as Record<string, unknown>)[key],
          `${path}/${key}`,
          element,
        );
    } else
      changes.push({
        element,
        path,
        before: JSON.stringify(clean(before)) ?? "Absent",
        after: JSON.stringify(clean(after)) ?? "Absent",
      });
  };
  for (const element of document.elements) {
    const old = base.elements.find((candidate) => candidate.id === element.id);
    if (!old) {
      changes.push({
        element: element.id,
        path: "element",
        before: "Absent",
        after: "Added",
      });
      continue;
    }
    walk(old.data, element.data, "data", element.id);
    walk(old.in_service, element.in_service, "in_service", element.id);
    walk(old.terminals, element.terminals, "terminals", element.id);
  }
  for (const old of base.elements)
    if (!document.elements.some((element) => element.id === old.id))
      changes.push({
        element: old.id,
        path: "element",
        before: "Present",
        after: "Removed",
      });
  for (const key of Object.keys(base.meta) as (keyof StudyDocument["meta"])[]) {
    if (key !== "modified_at" && key !== "created_at")
      walk(base.meta[key], document.meta[key], `meta/${key}`, "Case");
  }
  walk(base.settings, document.settings, "settings", "Case");
  return changes;
}
