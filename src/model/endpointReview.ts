import type { DrawingRef, EndpointObservation, StudyDocument } from "./types";
import { commitEngineeringEdit } from "./revision";
import { userValue } from "./editing";

export type EndpointTarget =
  | { kind: "terminal"; elementId: string; role: string }
  | { kind: "point"; pointId: string };
const pointer = (value: string) =>
  value.replace(/~/g, "~0").replace(/\//g, "~1");
const sameRef = (a: DrawingRef, b: DrawingRef) =>
  a.file_id === b.file_id &&
  a.page === b.page &&
  a.bbox.x_min === b.bbox.x_min &&
  a.bbox.y_min === b.bbox.y_min &&
  a.bbox.x_max === b.bbox.x_max &&
  a.bbox.y_max === b.bbox.y_max;
function endpointFor(document: StudyDocument, id: string): EndpointObservation {
  const endpoint = document.extraction.unresolved_endpoints.find(
    (candidate) => candidate.id === id,
  );
  if (!endpoint) throw new Error("Select an existing unresolved endpoint.");
  return endpoint;
}

/** Exact retained wire evidence identifies a net; proximity alone must never join crossing wires. */
export function endpointPointCandidates(
  document: StudyDocument,
  endpointId: string,
): string[] {
  const endpoint = endpointFor(document, endpointId);
  const observation = document.extraction.observations.find(
    (candidate) => candidate.id === endpoint.observation_id,
  );
  const refs = [
    endpoint.source_ref,
    ...(observation ? [observation.source_ref] : []),
  ];
  return document.connectivity_points
    .filter((point) => {
      const evidence = [
        ...point.evidence,
        ...(point.source_ref.kind === "drawing"
          ? [point.source_ref.primary, ...point.source_ref.evidence]
          : []),
      ];
      return evidence.some((source) =>
        refs.some((ref) => sameRef(source, ref)),
      );
    })
    .map((point) => point.id);
}

/** Join the actual canonical wire net to a user-selected terminal/net, then retire only this review issue. */
export function resolveEndpoint(
  document: StudyDocument,
  endpointId: string,
  target: EndpointTarget,
  options: { sourcePointId?: string; at?: string } = {},
): StudyDocument {
  const endpoint = endpointFor(document, endpointId),
    candidates = endpointPointCandidates(document, endpointId);
  const sourceId =
    options.sourcePointId ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (
    !sourceId ||
    !document.connectivity_points.some((point) => point.id === sourceId)
  )
    throw new Error(
      "Select the wire connection point before confirming this attachment.",
    );
  if (candidates.length && !candidates.includes(sourceId))
    throw new Error(
      "The selected wire connection point does not match the retained endpoint evidence.",
    );
  const at = options.at ?? new Date().toISOString();
  let targetId: string,
    targetPath: string | null = null,
    elementIds: string[] = [];
  if (target.kind === "point") {
    if (
      !document.connectivity_points.some((point) => point.id === target.pointId)
    )
      throw new Error("Select an existing target connection point.");
    targetId = target.pointId;
  } else {
    const index = document.elements.findIndex(
      (element) => element.id === target.elementId,
    );
    const terminal =
      index >= 0
        ? Object.entries(document.elements[index].terminals).find(
            ([role]) => role === target.role,
          )?.[1]
        : undefined;
    if (!terminal) throw new Error("Select an existing element terminal.");
    targetId =
      terminal.connection_point.status === "known"
        ? terminal.connection_point.value
        : sourceId;
    targetPath = `/elements/${index}/terminals/${pointer(target.role)}/connection_point`;
    elementIds = [target.elementId];
  }
  return commitEngineeringEdit(
    document,
    (draft) => {
      const sourcePoint = draft.connectivity_points.find(
        (point) => point.id === sourceId,
      )!;
      const targetPoint = draft.connectivity_points.find(
        (point) => point.id === targetId,
      )!;
      const evidence = [
        ...targetPoint.evidence,
        ...sourcePoint.evidence,
        endpoint.source_ref,
      ];
      targetPoint.evidence = evidence.filter(
        (ref, index) =>
          evidence.findIndex((candidate) => sameRef(candidate, ref)) === index,
      );
      for (const element of draft.elements)
        for (const [role, terminal] of Object.entries(element.terminals)) {
          const selected =
            target.kind === "terminal" &&
            element.id === target.elementId &&
            role === target.role;
          if (
            selected ||
            (sourceId !== targetId &&
              terminal.connection_point.status === "known" &&
              terminal.connection_point.value === sourceId)
          ) {
            terminal.connection_point = userValue(targetId, at, [
              endpoint.source_ref,
            ]);
            elementIds.push(element.id);
          }
        }
      if (sourceId !== targetId) {
        draft.connectivity_points = draft.connectivity_points.filter(
          (point) => point.id !== sourceId,
        );
        for (const island of draft.operation.island_policy
          .energized_island_slacks)
          island.connectivity_point_ids = [
            ...new Set(
              island.connectivity_point_ids.map((id) =>
                id === sourceId ? targetId : id,
              ),
            ),
          ];
      }
      const index = draft.extraction.unresolved_endpoints.findIndex(
        (candidate) => candidate.id === endpointId,
      );
      draft.extraction.unresolved_endpoints.splice(index, 1);
      draft.review.decisions.push({
        id: crypto.randomUUID(),
        element_ids: [...new Set(elementIds)],
        input_paths: [
          `/extraction/unresolved_endpoints/${index}`,
          "/connectivity_points",
          ...(targetPath ? [targetPath] : []),
        ],
        action: `Attached drawing endpoint ${endpointId}: wire net ${sourceId} to ${target.kind === "terminal" ? `${target.elementId}/${target.role}` : "connection point"} (${targetId}). Original observation and source evidence retained.`,
        at,
        revision: document.revision + 1,
      });
    },
    at,
  );
}

/** A human may classify a false positive as non-electrical, with its evidence and reason retained. */
export function annotateEndpoint(
  document: StudyDocument,
  endpointId: string,
  reason: string,
  at = new Date().toISOString(),
): StudyDocument {
  const endpoint = endpointFor(document, endpointId),
    explanation = reason.trim();
  if (!explanation)
    throw new Error(
      "Enter a reason for marking this endpoint as non-electrical.",
    );
  return commitEngineeringEdit(
    document,
    (draft) => {
      const index = draft.extraction.unresolved_endpoints.findIndex(
        (candidate) => candidate.id === endpointId,
      );
      draft.extraction.unresolved_endpoints.splice(index, 1);
      draft.extraction.annotations.push({
        id: crypto.randomUUID(),
        text: `Endpoint ${endpointId}: ${explanation}`,
        source_ref: {
          kind: "drawing",
          primary: structuredClone(endpoint.source_ref),
          evidence: [structuredClone(endpoint.source_ref)],
        },
        layout: {
          position: structuredClone(endpoint.position),
          rotation_degree: 0,
          width: 8,
          height: 8,
          route_points: [],
          page_group: `${endpoint.source_ref.file_id}:${endpoint.source_ref.page}`,
          bay_group: null,
          updated_at: at,
        },
        disposition: "annotation",
        review: {
          status: "confirmed",
          reviewed_revision: document.revision + 1,
          reviewed_at: at,
        },
      });
      draft.review.decisions.push({
        id: crypto.randomUUID(),
        element_ids: [],
        input_paths: [`/extraction/unresolved_endpoints/${index}`],
        action: `Marked drawing endpoint ${endpointId} as non-electrical: ${explanation}. Original perception observation and source evidence retained.`,
        at,
        revision: document.revision + 1,
      });
    },
    at,
  );
}
