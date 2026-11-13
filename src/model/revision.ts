import type { SolutionRun, StudyDocument } from "./types";
import {
  assertStudyDocument,
  inspectJsonValue,
  ModelValidationError,
} from "./validation";

/** Stable JSON with lexicographic object keys, preserving ordered arrays. */
export function canonicalStringify(value: unknown): string {
  const issues = inspectJsonValue(value);
  if (issues.length) throw new ModelValidationError(issues);
  const encode = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    if (item !== null && typeof item === "object")
      return `{${Object.keys(item)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`,
        )
        .join(",")}}`;
    return JSON.stringify(item) as string;
  };
  return encode(value);
}

/** Excludes layout/UI/results/history; includes accepted input provenance and outage policy. */
export function electricalSnapshot(document: StudyDocument): unknown {
  return {
    schema_version: document.schema_version,
    meta: {
      network_type: document.meta.network_type,
      frequency_hz: document.meta.frequency_hz,
      base_mva: document.meta.base_mva,
    },
    settings: document.settings,
    connectivity_point_ids: document.connectivity_points
      .map((point) => point.id)
      .sort(),
    elements: [...document.elements]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((element) => ({
        id: element.id,
        type: element.type,
        in_service: element.in_service,
        data: element.data,
        terminals: Object.fromEntries(
          Object.entries(element.terminals).map(([role, terminal]) => [
            role,
            {
              id: terminal.id,
              role: terminal.role,
              connection_point: terminal.connection_point,
            },
          ]),
        ),
      })),
    island_policy: document.operation.island_policy,
  };
}

export async function computeInputHash(
  document: StudyDocument,
): Promise<string> {
  const encoded = new TextEncoder().encode(
    canonicalStringify(electricalSnapshot(document)),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Call only for an explicit user review action or a trusted bundled reference fixture. */
export async function confirmReview(
  document: StudyDocument,
  at = new Date().toISOString(),
): Promise<StudyDocument> {
  assertStudyDocument(document);
  const reviewed = structuredClone(document);
  reviewed.review = {
    ...reviewed.review,
    status: "confirmed",
    confirmed_model_revision: reviewed.revision,
    confirmed_input_hash: await computeInputHash(reviewed),
    confirmed_at: at,
  };
  assertStudyDocument(reviewed);
  return reviewed;
}

/** Revision alone is insufficient: verify the exact accepted electrical inputs as well. */
export async function isReviewCurrent(
  document: StudyDocument,
): Promise<boolean> {
  return (
    document.review.status === "confirmed" &&
    document.review.confirmed_model_revision === document.revision &&
    document.review.confirmed_input_hash === (await computeInputHash(document))
  );
}

/** Use for engineering corrections. Operator actions get an explicit review-preserving path later. */
export function commitEngineeringEdit(
  original: StudyDocument,
  edit: (draft: StudyDocument) => void,
  at = new Date().toISOString(),
): StudyDocument {
  assertStudyDocument(original);
  const draft = structuredClone(original);
  edit(draft);
  draft.revision = original.revision + 1;
  draft.meta.modified_at = at;
  draft.review = {
    ...draft.review,
    status: "pending",
    confirmed_model_revision: null,
    confirmed_input_hash: null,
    confirmed_at: null,
  };
  draft.validation = null;
  if (draft.solution) draft.solution.status = "superseded";
  assertStudyDocument(draft);
  return draft;
}

/** Worker completions cannot overwrite an edited case, even when they finish later. */
export async function attachSolution(
  document: StudyDocument,
  run: SolutionRun,
): Promise<StudyDocument> {
  assertStudyDocument(document);
  if (run.model_revision !== document.revision)
    throw new Error("Solver result revision does not match the current case.");
  if (run.input_hash !== (await computeInputHash(document)))
    throw new Error(
      "Solver result input hash does not match the current case.",
    );
  const next = structuredClone(document);
  next.solution = structuredClone(run);
  assertStudyDocument(next);
  return next;
}
