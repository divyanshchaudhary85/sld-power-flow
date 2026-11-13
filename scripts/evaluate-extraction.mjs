#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    !["--case", "--truth", "--out", "--mode"].includes(args[i]) ||
    !args[i + 1]
  )
    throw new Error(
      "Usage: node scripts/evaluate-extraction.mjs --case extracted-case.json --truth human-truth.json --out metrics.json --mode live_vision|deterministic_fixture",
    );
  options[args[i].slice(2)] = args[i + 1];
}
if (
  !options.case ||
  !options.truth ||
  !options.out ||
  !["live_vision", "deterministic_fixture"].includes(options.mode)
)
  throw new Error(
    "Provide --case, --truth, --out and explicit --mode. This command performs no network calls.",
  );
const document = JSON.parse(await readFile(resolve(options.case), "utf8"));
const truth = JSON.parse(await readFile(resolve(options.truth), "utf8"));
const schema = JSON.parse(
  await readFile(resolve(root, "schema/study-document.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ strict: true, allErrors: false });
addFormats(ajv);
if (!ajv.validate(schema, document))
  throw new Error(
    `The case is not a valid StudyDocument: ${ajv.errors?.[0]?.instancePath ?? "/"}`,
  );
const truthSchema = JSON.parse(
  await readFile(resolve(root, "schema/extraction-truth.schema.json"), "utf8"),
);
if (!ajv.validate(truthSchema, truth))
  throw new Error(
    `Human-labelled truth is invalid: ${ajv.errors?.[0]?.instancePath ?? "/"}`,
  );
const ids = new Set(truth.components.map((component) => component.id));
if (
  ids.size !== truth.components.length ||
  truth.connections.some((pair) =>
    pair.some((endpoint) => !ids.has(endpoint.element)),
  )
)
  throw new Error(
    "Truth IDs must be unique and connections must reference them.",
  );
if (
  options.mode === "live_vision" &&
  (!document.extraction.runs.length ||
    document.extraction.runs.some((run) =>
      /deterministic|fixture|synthetic/i.test(run.provider),
    ))
)
  throw new Error(
    "Live-vision evaluation requires actual provider run provenance, not a deterministic fixture.",
  );

// Reuse exactly the app's metric implementation. TypeScript is a pinned development dependency.
// Both modules are local repository code; supplied JSON is never evaluated as JavaScript.
const asModule = (text) =>
  `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
const geometry = asModule(
  transpile(await readFile(resolve(root, "src/ingestion/geometry.ts"), "utf8")),
);
const code = transpile(
  await readFile(resolve(root, "src/extraction/evaluation.ts"), "utf8"),
).replace("'../ingestion/geometry'", JSON.stringify(geometry));
const { evaluateExtraction } = await import(asModule(code));
const metrics = evaluateExtraction(document, truth, options.mode);
const hasUserField = (value) =>
  !!value &&
  typeof value === "object" &&
  (value.provenance?.source === "user" ||
    Object.values(value).some(hasUserField));
const report = {
  ...metrics,
  evaluated_at: new Date().toISOString(),
  case_id: document.case_id,
  revision: document.revision,
  review_status: document.review.status,
  human_edits_present: document.elements.some(hasUserField),
  runs: document.extraction.runs.map(
    ({ id, provider, model, started_at, success_count, tile_count }) => ({
      id,
      provider,
      model,
      started_at,
      success_count,
      tile_count,
    }),
  ),
  limitations: [
    "Only supplied human-labelled truth is scored; ground-truth correctness is not automatically verified.",
    "Evaluate the unedited extraction draft to measure extraction. Corrected cases measure the combined extraction and human review process.",
    "Connections are pairwise same-net terminal relationships; a net with n labelled terminals requires n*(n-1)/2 truth pairs.",
    "This evaluates component type/location, exact normalized label text and terminal connectivity separately. It does not certify engineering attribute accuracy.",
  ],
};
await writeFile(resolve(options.out), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      mode: report.mode,
      components: report.components,
      text: report.text,
      connections: report.connections,
      human_edits_present: report.human_edits_present,
    },
    null,
    2,
  ),
);
