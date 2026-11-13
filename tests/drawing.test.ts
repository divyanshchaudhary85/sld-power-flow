import { describe, it, expect } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { diagramSVG, sceneGeometry } from "../src/ui/diagram";
import { parseStudyDocument } from "../src/model";
describe("own synthetic symbol renderer", () => {
  it("renders the actual fixture topology without displaying reference results", async () => {
    const doc = parseStudyDocument(
      readFileSync("public/fixtures/case9.json", "utf8"),
    );
    const svg = await diagramSVG(doc);
    expect(svg).toContain("<svg");
    expect(svg).toContain("line-0");
    expect(svg).not.toContain("319.955");
    expect(sceneGeometry(doc).positions.size).toBe(doc.elements.length);
    mkdirSync("test-results/drawings", { recursive: true });
    writeFileSync("test-results/drawings/case9.svg", svg);
  });
  it.each(["case14", "case9-breaker", "case50"])(
    "renders %s from the same symbols and canonical connections",
    async (name) => {
      const doc = parseStudyDocument(
        readFileSync(`public/fixtures/${name}.json`, "utf8"),
      );
      const svg = await diagramSVG(doc);
      expect(svg).toContain("<svg");
      expect(svg).not.toContain("NaN");
      expect(sceneGeometry(doc).positions.size).toBe(doc.elements.length);
      mkdirSync("test-results/drawings", { recursive: true });
      writeFileSync(`test-results/drawings/${name}.svg`, svg);
    },
  );
});
