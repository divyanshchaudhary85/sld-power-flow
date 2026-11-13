import { it } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { analyzeTopology, validateNetwork } from "../src/validation";
import { listMissingData } from "../src/completion/missing";
import {
  canonicalStringify,
  computeInputHash,
  confirmReview,
  electricalSnapshot,
} from "../src/model/revision";
import {
  inspectJsonValue,
  validateStudyDocument,
} from "../src/model/validation";
import type { StudyDocument } from "../src/model/types";
import { captureBase } from "../src/operations";

it.skipIf(!process.env.PERFORMANCE_PROFILE)(
  "records actual Node hot-path timings without timing assertions",
  async () => {
    const document = JSON.parse(
      readFileSync("public/fixtures/case50.json", "utf8"),
    ) as StudyDocument;
    const withBase = await captureBase(await confirmReview(document));
    const operations: Record<string, () => unknown> = {
      structuredClone: () => structuredClone(document),
      inspectJsonValue: () => inspectJsonValue(document),
      validateStudyDocument: () => validateStudyDocument(document),
      canonicalSnapshot: () => canonicalStringify(electricalSnapshot(document)),
      computeInputHash: () => computeInputHash(document),
      analyzeTopology: () => analyzeTopology(document),
      listMissingData: () => listMissingData(document),
      validateNetwork: () => validateNetwork(document),
      confirmReview: () => confirmReview(document),
      validateWithBase: () => validateStudyDocument(withBase),
      confirmWithBase: () => confirmReview(withBase),
    };
    const timings: Record<string, unknown> = {};
    for (const [name, operation] of Object.entries(operations)) {
      const first = performance.now();
      await operation();
      const first_ms = performance.now() - first;
      for (let i = 0; i < 5; i++) await operation();
      const samples: number[] = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        await operation();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      timings[name] = {
        first_ms,
        median_ms: samples[15],
        p95_ms: samples[28],
        mean_ms: samples.reduce((a, b) => a + b, 0) / samples.length,
      };
    }
    const semantics: Record<string, unknown> = {};
    for (const name of ["case9", "case14", "case50", "case9-breaker"]) {
      const doc = JSON.parse(
        readFileSync(`public/fixtures/${name}.json`, "utf8"),
      ) as StudyDocument;
      const data = {
        topology: analyzeTopology(doc),
        findings: validateNetwork(doc),
        missing: listMissingData(doc),
        input_hash: await computeInputHash(doc),
      };
      semantics[name] = {
        sha256: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
        ...data,
      };
    }
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      `test-results/performance-${process.env.PERFORMANCE_PROFILE}.json`,
      JSON.stringify(
        {
          environment: "Node 22 / Vitest; not a browser performance claim",
          elements: document.elements.length,
          timings,
          semantics,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(timings));
  },
  60_000,
);
