import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { StudyDocument } from "../src/model";
import { assertStudyDocument, missingValue, userValue } from "../src/model";
import { runRule } from "../src/validation";
import {
  annotateEndpoint,
  endpointPointCandidates,
  resolveEndpoint,
} from "../src/model/endpointReview";

const at = "2026-11-13T00:00:00Z";
function draft() {
  const document = JSON.parse(
    readFileSync(
      new URL("../docs/evaluation/synthetic-case.json", import.meta.url),
      "utf8",
    ),
  ) as StudyDocument;
  const wire = document.extraction.observations.find((observation) =>
    observation.id.includes("/wire/"),
  )!;
  wire.terminals[1].attached_observation_id = missingValue();
  document.extraction.unresolved_endpoints = [
    structuredClone(wire.terminals[1]),
  ];
  const load = document.elements.find(
    (element) => element.type.value === "load",
  )!;
  document.connectivity_points.push({
    id: "detached",
    kind: "terminal_point",
    position: { x: 800, y: 300 },
    source_ref: {
      kind: "user_added",
      created_at: at,
      manually_marked_region: null,
    },
    evidence: [],
  });
  Object.values(load.terminals)[0].connection_point = userValue("detached", at);
  assertStudyDocument(document);
  return { document, wire, endpointId: wire.terminals[1].id, loadId: load.id };
}

describe("explicit drawing endpoint review", () => {
  it("connects the actual wire net to the selected terminal and retains evidence", () => {
    const { document, endpointId, loadId } = draft();
    const source = endpointPointCandidates(document, endpointId)[0];
    expect(source).toBe("point-1");
    expect(runRule("D03", document)).toHaveLength(1);
    const corrected = resolveEndpoint(
      document,
      endpointId,
      { kind: "terminal", elementId: loadId, role: "bus" },
      { at },
    );
    expect(corrected.revision).toBe(document.revision + 1);
    expect(corrected.review.status).toBe("pending");
    expect(corrected.validation).toBeNull();
    expect(
      corrected.elements.map(
        (element) => Object.values(element.terminals)[0].connection_point,
      ),
    ).toEqual([
      expect.objectContaining({ value: "detached" }),
      expect.objectContaining({ value: "detached" }),
    ]);
    expect(corrected.connectivity_points).toHaveLength(1);
    expect(corrected.connectivity_points[0].evidence.length).toBeGreaterThan(0);
    expect(runRule("D03", corrected)).toHaveLength(0);
    expect(corrected.review.decisions.at(-1)?.action).toContain(endpointId);
    expect(document.connectivity_points).toHaveLength(2);
    expect(document.extraction.unresolved_endpoints).toHaveLength(1);
    assertStudyDocument(corrected);
  });
  it("attaches a previously missing terminal without inventing a new point", () => {
    const { document, endpointId, loadId } = draft();
    Object.values(
      document.elements.find((element) => element.id === loadId)!.terminals,
    )[0].connection_point = missingValue();
    const corrected = resolveEndpoint(
      document,
      endpointId,
      { kind: "terminal", elementId: loadId, role: "bus" },
      { at },
    );
    expect(
      Object.values(
        corrected.elements.find((element) => element.id === loadId)!.terminals,
      )[0].connection_point,
    ).toMatchObject({
      status: "known",
      value: "point-1",
      provenance: { source: "user" },
    });
    assertStudyDocument(corrected);
  });
  it("requires an explicit source net when evidence is ambiguous and rejects invalid targets", () => {
    const { document, endpointId, loadId } = draft();
    const duplicate = structuredClone(document.connectivity_points[0]);
    duplicate.id = "ambiguous";
    document.connectivity_points.push(duplicate);
    expect(endpointPointCandidates(document, endpointId)).toHaveLength(2);
    expect(() =>
      resolveEndpoint(document, endpointId, {
        kind: "point",
        pointId: "detached",
      }),
    ).toThrow("wire connection point");
    expect(() =>
      resolveEndpoint(
        document,
        endpointId,
        { kind: "terminal", elementId: loadId, role: "not-a-terminal" },
        { sourcePointId: "point-1" },
      ),
    ).toThrow("terminal");
    expect(() =>
      resolveEndpoint(
        document,
        endpointId,
        { kind: "point", pointId: "missing" },
        { sourcePointId: "point-1" },
      ),
    ).toThrow("target");
    expect(() =>
      resolveEndpoint(document, "already-resolved", {
        kind: "point",
        pointId: "detached",
      }),
    ).toThrow("unresolved endpoint");
    const corrected = resolveEndpoint(
      document,
      endpointId,
      { kind: "point", pointId: "detached" },
      { sourcePointId: "point-1", at },
    );
    expect(runRule("D03", corrected)).toHaveLength(0);
  });
  it("preserves non-electrical endpoint evidence as an annotation and records the reason", () => {
    const { document, endpointId } = draft();
    const endpoint = structuredClone(
      document.extraction.unresolved_endpoints[0],
    );
    expect(() => annotateEndpoint(document, endpointId, "  ")).toThrow(
      "reason",
    );
    const corrected = annotateEndpoint(
      document,
      endpointId,
      "Dimension leader, not an electrical conductor",
      at,
    );
    expect(corrected.elements).toEqual(document.elements);
    expect(corrected.connectivity_points).toEqual(document.connectivity_points);
    expect(corrected.extraction.observations).toEqual(
      document.extraction.observations,
    );
    expect(corrected.extraction.annotations.at(-1)).toMatchObject({
      disposition: "annotation",
      text: expect.stringContaining("Dimension leader"),
      source_ref: { kind: "drawing", primary: endpoint.source_ref },
      layout: { position: endpoint.position },
      review: { status: "confirmed", reviewed_revision: corrected.revision },
    });
    expect(corrected.review.decisions.at(-1)?.action).toContain(
      "Dimension leader",
    );
    expect(corrected.review.status).toBe("pending");
    expect(runRule("D03", corrected)).toHaveLength(0);
    assertStudyDocument(corrected);
  });
  it("resolves only the selected issue and keeps later wire evidence usable after a merge", () => {
    const { document, wire, endpointId } = draft();
    wire.terminals[0].attached_observation_id = missingValue();
    document.extraction.unresolved_endpoints.push(
      structuredClone(wire.terminals[0]),
    );
    const corrected = resolveEndpoint(
      document,
      endpointId,
      { kind: "point", pointId: "detached" },
      { at },
    );
    expect(
      corrected.extraction.unresolved_endpoints.map((endpoint) => endpoint.id),
    ).toEqual([wire.terminals[0].id]);
    expect(endpointPointCandidates(corrected, wire.terminals[0].id)).toEqual([
      "detached",
    ]);
    expect(runRule("D03", corrected)).toHaveLength(1);
  });
});
