import { describe, it, expect } from "vitest";
import { toCSV, solutionTables } from "../src/exports/tables";
import { parseStudyDocument } from "../src/model";
import { readFileSync } from "node:fs";
describe("solution exports", () => {
  it("preserves numerical signs and neutralizes spreadsheet formulas in text", () => {
    const csv = toCSV({
      name: "test",
      rows: [
        {
          label: "=SUM(A1:A2)",
          number: -1.25,
          missing: null,
          quote: 'a,"b"\nc',
        },
      ],
    });
    expect(csv).toContain('"\'=SUM(A1:A2)"');
    expect(csv).toContain('"-1.25"');
    expect(csv).toContain('"a,""b""\nc"');
  });
  it("refuses unsolved cases instead of emitting reference answers", () => {
    const doc = parseStudyDocument(
      readFileSync("public/fixtures/case9.json", "utf8"),
    );
    expect(() => solutionTables(doc)).toThrow("current converged");
  });
});
