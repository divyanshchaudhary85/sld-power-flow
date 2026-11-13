import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/study-document.schema.json";
import { createDraft, createElement } from "../src/extraction/model";
import { ELEMENT_TYPES } from "../src/extraction/types";
import { validateStudyDocument } from "../src/model/validation";
import { analyzeTopology, validateNetwork } from "../src/validation";
import { listMissingData } from "../src/completion/missing";
import { readFileSync } from "node:fs";
import type { StudyDocument } from "../src/model/types";

const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const authoritative = ajv.compile(schema);
describe("tag-indexed schema validation", () => {
  it("agrees with the full authoritative union for every equipment kind and malformed branch", () => {
    for (const [index, type] of ELEMENT_TYPES.entries()) {
      const doc = createDraft();
      doc.elements = [createElement(type, "test")];
      expect(authoritative(doc)).toBe(true);
      expect(validateStudyDocument(doc).valid).toBe(true);
      const extra = structuredClone(doc);
      Object.assign(extra.elements[0].data, {
        unrecognized_attribute: {
          status: "missing",
          reason: "not_shown",
          candidates: [],
          evidence: [],
        },
      });
      expect(authoritative(extra)).toBe(false);
      expect(validateStudyDocument(extra).valid).toBe(false);
      const changedTag = structuredClone(doc);
      changedTag.elements[0].type.value =
        ELEMENT_TYPES[(index + 1) % ELEMENT_TYPES.length];
      expect(validateStudyDocument(changedTag).valid).toBe(
        authoritative(changedTag),
      );
      const changedProvenance = structuredClone(doc);
      Object.assign(changedProvenance.elements[0].type.provenance, {
        source: "unrecognized_source",
      });
      expect(authoritative(changedProvenance)).toBe(false);
      expect(validateStudyDocument(changedProvenance).valid).toBe(false);
    }
  });
  it("rejects missing tags, invalid terminal roles and invalid elements nested in a saved base", () => {
    const doc = createDraft();
    doc.elements = [createElement("busbar", "test")];
    for (const patch of [null, {}, { status: "known", value: "not_a_type" }]) {
      const invalid = structuredClone(doc);
      Object.assign(invalid.elements[0], { type: patch });
      expect(authoritative(invalid)).toBe(false);
      expect(validateStudyDocument(invalid).valid).toBe(false);
    }
    const base = structuredClone(doc);
    base.operation.base_snapshot = {
      revision: 0,
      input_hash: "0".repeat(64),
      meta: structuredClone(doc.meta),
      settings: structuredClone(doc.settings),
      connectivity_points: [],
      elements: structuredClone(doc.elements),
    };
    Object.assign(base.operation.base_snapshot.elements[0].terminals, {
      unexpected: {},
    });
    expect(authoritative(base)).toBe(false);
    expect(validateStudyDocument(base).valid).toBe(false);
  });
  it("does not retain stale validation or topology after in-place changes", () => {
    const doc = JSON.parse(
      readFileSync("public/fixtures/case50.json", "utf8"),
    ) as StudyDocument;
    expect(validateStudyDocument(doc).valid).toBe(true);
    expect(listMissingData(doc, analyzeTopology(doc))).toEqual(
      listMissingData(doc),
    );
    const before = validateNetwork(doc);
    doc.settings.slack_confirmed = {
      status: "missing",
      reason: "not_entered",
      candidates: [],
      evidence: [],
    };
    expect(validateNetwork(doc)).not.toEqual(before);
    Object.assign(doc.elements[0], { unrecognized: 1 });
    expect(validateStudyDocument(doc).valid).toBe(false);
  });
});
