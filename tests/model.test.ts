import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import template from "../schema/fixture-template.json";
import {
  attachSolution,
  canonicalStringify,
  commitEngineeringEdit,
  confirmReview,
  computeInputHash,
  isReviewCurrent,
  ModelValidationError,
  parseStudyDocument,
  validateStudyDocument,
} from "../src/model";
import type { Busbar, SolutionRun, StudyDocument } from "../src/model/types";

const at = "2026-11-13T00:00:00Z";
function field<T>(value: T) {
  return {
    status: "known" as const,
    value,
    provenance: {
      source: "library" as const,
      library_id: "test-fixture",
      library_version: "1",
      item_id: "test",
      accepted_at: at,
    },
    derivation: null,
  };
}
function fixture(): StudyDocument {
  return structuredClone(template) as StudyDocument;
}
function bus(id = "b1"): Busbar {
  return {
    id,
    type: field("busbar" as const),
    label: field(id),
    in_service: field(true),
    source_ref: {
      kind: "synthetic",
      fixture_id: "test",
      generated_drawing: null,
    },
    layout: {
      position: { x: 0, y: 0 },
      rotation_degree: 0,
      width: null,
      height: null,
      route_points: [],
      page_group: null,
      bay_group: null,
      updated_at: at,
    },
    review: {
      status: "unreviewed",
      reviewed_revision: null,
      reviewed_at: null,
    },
    station: field(null),
    bay: field(null),
    notes: field(null),
    terminals: {
      bus: {
        id: `${id}-terminal`,
        role: "bus",
        connection_point: field("n1"),
        source_ref: {
          kind: "synthetic",
          fixture_id: "test",
          generated_drawing: null,
        },
        drawn_anchor: null,
      },
    },
    data: {
      nominal_kv: field(132),
      voltage_min_pu: field(null),
      voltage_max_pu: field(null),
    },
  };
}
function connectedFixture(): StudyDocument {
  const doc = fixture();
  doc.connectivity_points.push({
    id: "n1",
    kind: "junction",
    position: { x: 0, y: 0 },
    source_ref: {
      kind: "synthetic",
      fixture_id: "test",
      generated_drawing: null,
    },
    evidence: [],
  });
  doc.elements.push(bus());
  return doc;
}
function failedRun(hash: string, revision = 0): SolutionRun {
  return {
    id: "run1",
    model_revision: revision,
    input_hash: hash,
    requested_at: at,
    completed_at: at,
    status: "failed",
    solver: {
      backend: "pandapower",
      backend_version: "test",
      runtime: "native",
      runtime_version: "test",
      package_lock_digest: "test",
      algorithm: "newton_raphson",
      tolerance_mva: 1e-8,
      max_iterations: 30,
      enforce_q_limits: false,
      transformer_equivalent: "t",
    },
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
  };
}

describe("approved canonical model boundary", () => {
  it.each([9, 14])(
    "accepts the committed IEEE %i-bus fixture without mutating its inputs",
    (buses) => {
      const raw = readFileSync(
        new URL(`../public/fixtures/case${buses}.json`, import.meta.url),
        "utf8",
      );
      const document = parseStudyDocument(raw);
      expect(
        document.elements.filter((element) => element.type.value === "busbar"),
      ).toHaveLength(buses);
      expect(document.meta.case_origin).toMatchObject({
        status: "known",
        value: "sample",
      });
      expect(document.solution).toBeNull();
      expect(JSON.stringify(document)).toBe(JSON.stringify(JSON.parse(raw)));
    },
  );
  it("accepts the complete draft envelope without inventing a slack source", () => {
    const result = validateStudyDocument(fixture());
    expect(result.valid).toBe(true);
    expect(
      parseStudyDocument(JSON.stringify(template)).settings.slack_element_id
        .status,
    ).toBe("missing");
  });
  it("rejects unknown keys and malformed imported JSON", () => {
    expect(
      validateStudyDocument({ ...fixture(), api_key: "must-not-be-in-model" })
        .valid,
    ).toBe(false);
    expect(() => parseStudyDocument("{")).toThrow(ModelValidationError);
  });
  it.each([NaN, Infinity, -Infinity])(
    "rejects nonfinite input before serialization can hide it: %s",
    (value) => {
      const doc = fixture();
      doc.meta.base_mva = field(value);
      const result = validateStudyDocument(doc);
      expect(result.valid).toBe(false);
      if (!result.valid)
        expect(
          result.issues.some((issue) => issue.code === "NON_JSON_VALUE"),
        ).toBe(true);
    },
  );
  it("rejects cycles and undefined rather than silently dropping them", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateStudyDocument(cyclic).valid).toBe(false);
    expect(() => canonicalStringify({ omitted: undefined })).toThrow(
      ModelValidationError,
    );
  });
  it("distinguishes unknown values from accepted zero and requires drawing confidence", () => {
    const doc = connectedFixture();
    const element = doc.elements[0] as Busbar;
    element.data.nominal_kv = field(0);
    expect(validateStudyDocument(doc).valid).toBe(true); // Plausibility belongs to Phase 2 rules.
    element.data.nominal_kv = {
      status: "missing",
      reason: "unreadable",
      candidates: [],
      evidence: [],
    };
    expect(validateStudyDocument(doc).valid).toBe(true);
    const invalid = JSON.parse(JSON.stringify(doc));
    invalid.elements[0].data.nominal_kv = {
      status: "known",
      value: 132,
      provenance: {
        source: "drawing",
        evidence: [],
        extraction_run_id: "ex1",
        reviewed: false,
      },
      derivation: null,
    };
    expect(validateStudyDocument(invalid).valid).toBe(false);
  });
  it("detects duplicate identities and a known terminal reference to an absent point", () => {
    const doc = connectedFixture();
    doc.elements.push(bus());
    const duplicates = validateStudyDocument(doc);
    expect(duplicates.valid).toBe(false);
    if (!duplicates.valid)
      expect(duplicates.issues.some((i) => i.code === "DUPLICATE_ID")).toBe(
        true,
      );
    doc.elements.pop();
    doc.connectivity_points = [];
    const dangling = validateStudyDocument(doc);
    expect(dangling.valid).toBe(false);
    if (!dangling.valid)
      expect(dangling.issues.some((i) => i.code === "MISSING_REFERENCE")).toBe(
        true,
      );
  });
  it("checks source page references and bounding-box order", () => {
    const doc = connectedFixture();
    doc.elements[0].source_ref = {
      kind: "drawing",
      primary: {
        file_id: "absent",
        page: 1,
        bbox: { x_min: 0.8, x_max: 0.2, y_min: 0, y_max: 1 },
        text_span_ids: [],
      },
      evidence: [],
    };
    const result = validateStudyDocument(doc);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.code === "MISSING_REFERENCE")).toBe(
        true,
      );
      expect(result.issues.some((i) => i.code === "INVALID_BOX")).toBe(true);
    }
  });
});

describe("reproducibility and stale-result protection", () => {
  it("confirms only the reviewed clone and verifies its exact input hash", async () => {
    const original = connectedFixture();
    expect(await isReviewCurrent(original)).toBe(false);
    const reviewed = await confirmReview(original, at);
    expect(await isReviewCurrent(reviewed)).toBe(true);
    expect(reviewed.review.confirmed_at).toBe(at);
    expect(original.review.status).toBe("pending");
    reviewed.meta.base_mva = field(200); // Detect even an edit that bypasses the revision helper.
    expect(await isReviewCurrent(reviewed)).toBe(false);
  });
  it("hashes equivalent property ordering identically", async () => {
    expect(canonicalStringify({ b: 2, a: 1 })).toBe(
      canonicalStringify({ a: 1, b: 2 }),
    );
    const doc = connectedFixture();
    expect(await computeInputHash(doc)).toMatch(/^[a-f0-9]{64}$/);
    expect(await computeInputHash(doc)).toBe(
      await computeInputHash(JSON.parse(JSON.stringify(doc))),
    );
  });
  it("changes the input hash for engineering edits but not visual positioning", async () => {
    const doc = connectedFixture();
    const original = await computeInputHash(doc);
    doc.elements[0].layout.position.x = 100;
    doc.operation.display_preferences.theme = "light";
    expect(await computeInputHash(doc)).toBe(original);
    (doc.elements[0] as Busbar).data.nominal_kv = field(33);
    expect(await computeInputHash(doc)).not.toBe(original);
  });
  it("edits a cloned revision, invalidates review/validation, and supersedes old results", async () => {
    const doc = connectedFixture();
    const hash = await computeInputHash(doc);
    doc.review = {
      ...doc.review,
      status: "confirmed",
      confirmed_model_revision: 0,
      confirmed_input_hash: hash,
      confirmed_at: at,
    };
    doc.solution = failedRun(hash);
    const originalBase = structuredClone(doc.meta.base_mva);
    const edited = commitEngineeringEdit(
      doc,
      (draft) => {
        draft.meta.base_mva = field(200);
      },
      at,
    );
    expect(edited.revision).toBe(1);
    expect(doc.revision).toBe(0);
    expect(doc.meta.base_mva).toEqual(originalBase);
    expect(edited.review.status).toBe("pending");
    expect(edited.validation).toBeNull();
    expect(edited.solution?.status).toBe("superseded");
  });
  it("accepts a current run and rejects mismatched revision or hash", async () => {
    const doc = connectedFixture();
    const hash = await computeInputHash(doc);
    expect((await attachSolution(doc, failedRun(hash))).solution?.id).toBe(
      "run1",
    );
    await expect(attachSolution(doc, failedRun(hash, 2))).rejects.toThrow(
      /revision/i,
    );
    await expect(attachSolution(doc, failedRun("wrong"))).rejects.toThrow(
      /hash/i,
    );
    expect(doc.solution).toBeNull();
  });
  it("rejects a purported converged run without actual results", async () => {
    const doc = connectedFixture();
    const run = failedRun(await computeInputHash(doc));
    run.status = "converged";
    await expect(attachSolution(doc, run)).rejects.toThrow(
      /converged result set/i,
    );
  });
});
