import { describe, expect, it } from "vitest";
import { flowArrow, defaultDependent } from "../src/ui/resultQuality";
import type { StudyDocument } from "../src/model";

describe("flow direction and default traceability", () => {
  it("uses each terminal sign and geometry rather than mirroring labels blindly", () => {
    expect(flowArrow(10, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe("→");
    expect(flowArrow(-9, { x: 20, y: 0 }, { x: 10, y: 0 })).toBe("→");
    expect(flowArrow(10, { x: 0, y: 0 }, { x: 0, y: 10 })).toBe("↓");
    expect(flowArrow(-9, { x: 0, y: 20 }, { x: 0, y: 10 })).toBe("↓");
    expect(flowArrow(null, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe("");
    expect(flowArrow(0, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe("");
  });
  it("marks only results with an intersecting dependency, including table prefixes", () => {
    const doc = {
      solution: {
        quality: {
          defaulted_input_paths: ["/elements/2/data/p_mw"],
          dependencies: [
            {
              result_path: "/results/buses/0",
              input_paths: ["/elements/1/data/p_mw"],
            },
            {
              result_path: "/results/buses/1",
              input_paths: ["/elements/2/data/p_mw"],
            },
            {
              result_path: "/results/loads",
              input_paths: ["/elements/2/data/p_mw"],
            },
          ],
        },
      },
    } as StudyDocument;
    expect(defaultDependent(doc, "/results/buses/0")).toBe(false);
    expect(defaultDependent(doc, "/results/buses/1/voltage_kv")).toBe(true);
    expect(defaultDependent(doc, "/results/buses/10")).toBe(false);
    expect(defaultDependent(doc, "/results/loads/0")).toBe(true);
  });
});
