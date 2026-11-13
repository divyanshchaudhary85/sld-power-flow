import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../schema/study-document.schema.json";
import type { StudyDocument } from "./types";

export type ModelIssue = {
  code:
    | "NON_JSON_VALUE"
    | "INVALID_JSON"
    | "SCHEMA"
    | "DUPLICATE_ID"
    | "MISSING_REFERENCE"
    | "INVALID_BOX"
    | "INVALID_REVISION"
    | "INVALID_STATE";
  path: string;
  message: string;
};
export type ModelValidationResult =
  | { valid: true; document: StudyDocument }
  | { valid: false; issues: ModelIssue[] };

export class ModelValidationError extends Error {
  constructor(public readonly issues: ModelIssue[]) {
    super(
      issues
        .map((issue) => `${issue.path || "/"}: ${issue.message}`)
        .join("\n"),
    );
    this.name = "ModelValidationError";
  }
}

const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** JSON.stringify changes nonfinite values into null and drops undefined. Reject them first. */
export function inspectJsonValue(value: unknown): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const ancestors = new Set<object>();
  const visit = (item: unknown, path: string): void => {
    const reject = (message: string) =>
      issues.push({ code: "NON_JSON_VALUE", path, message });
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return;
    if (typeof item === "number") {
      if (!Number.isFinite(item))
        reject("Numbers must be finite JSON numbers.");
      return;
    }
    if (typeof item !== "object") {
      reject(`The value ${typeof item} is not JSON data.`);
      return;
    }
    if (ancestors.has(item)) {
      reject("Cyclic objects cannot form a case document.");
      return;
    }
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      reject("Only plain JSON objects are accepted.");
      return;
    }
    if (Object.getOwnPropertySymbols(item).length)
      reject("Symbol keys are not JSON data.");
    ancestors.add(item);
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) {
        if (!(i in item))
          issues.push({
            code: "NON_JSON_VALUE",
            path: `${path}/${i}`,
            message: "Sparse arrays are not JSON data.",
          });
        else visit(item[i], `${path}/${i}`);
      }
    } else {
      // Avoid allocating a second full descriptor map for every small provenance/field object.
      for (const key of Object.getOwnPropertyNames(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (descriptor.get || descriptor.set) {
          issues.push({
            code: "NON_JSON_VALUE",
            path: `${path}/${pointer(key)}`,
            message: "Accessor properties are not JSON data.",
          });
        } else visit(descriptor.value, `${path}/${pointer(key)}`);
      }
    }
    ancestors.delete(item);
  };
  visit(value, "");
  return issues;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: true,
  validateFormats: true,
});
addFormats(ajv);
const validateSchema = ajv.compile<StudyDocument>(schema);

// The authoritative Element union has fourteen mutually exclusive literal type tags.
// Validate the envelope and selected branch first, avoiding thirteen repeated scans of
// each valid element's common fields. Invalid inputs still receive the original full
// schema validation below. No document or result is cached across calls.
const fastSchema = {
  ...schema,
  $id: `${schema.$id}:tag-index`,
  $defs: {
    ...schema.$defs,
    StudyDocument: {
      ...schema.$defs.StudyDocument,
      properties: {
        ...schema.$defs.StudyDocument.properties,
        elements: {
          ...schema.$defs.StudyDocument.properties.elements,
          items: true,
        },
      },
    },
  },
};
const fastAjv = new Ajv2020({
  allErrors: false,
  strict: true,
  strictRequired: true,
  validateFormats: true,
});
addFormats(fastAjv);
const validateEnvelope = fastAjv.compile<StudyDocument>(fastSchema);
type SchemaDefinition = {
  properties?: Record<string, { $ref?: string; const?: string }>;
};
const definitions = schema.$defs as unknown as Record<string, SchemaDefinition>;
const elementValidators = new Map(
  schema.$defs.Element.oneOf.map((branch) => {
    const name = branch.$ref.split("/").at(-1)!;
    const tagName = definitions[name].properties!.type.$ref!.split("/").at(-1)!;
    const tag = definitions[tagName].properties!.value.const!;
    return [
      tag,
      fastAjv.compile({ $ref: `${fastSchema.$id}${branch.$ref}` }),
    ] as const;
  }),
);
function validateTaggedDocument(input: unknown): input is StudyDocument {
  if (!validateEnvelope(input)) return false;
  return input.elements.every(
    (element) =>
      element &&
      typeof element === "object" &&
      elementValidators.get(element.type?.value)?.(element) === true,
  );
}

/** Structural integrity only. Engineering plausibility and energization are Phase 2 rules. */
export function inspectStructuralReferences(
  document: StudyDocument,
): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const report = (code: ModelIssue["code"], path: string, message: string) =>
    issues.push({ code, path, message });
  const unique = (rows: { id: string }[], path: string): Set<string> => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (seen.has(row.id))
        report(
          "DUPLICATE_ID",
          `${path}/${index}/id`,
          `Duplicate ID "${row.id}".`,
        );
      seen.add(row.id);
    });
    return seen;
  };
  const elements = unique(document.elements, "/elements");
  const points = unique(document.connectivity_points, "/connectivity_points");
  unique(
    document.source_files.map((file) => ({ id: file.file_id })),
    "/source_files",
  );
  const files = new Map(
    document.source_files.map((file) => [file.file_id, file]),
  );
  const runs = unique(document.extraction.runs, "/extraction/runs");
  const observations = unique(
    document.extraction.observations,
    "/extraction/observations",
  );
  unique(document.extraction.annotations, "/extraction/annotations");
  unique(
    document.extraction.unassociated_text,
    "/extraction/unassociated_text",
  );
  const terminalIds = new Set<string>();
  const tileIds = new Set<string>();
  const expectReference = (
    ids: Set<string>,
    id: string,
    path: string,
    kind: string,
  ) => {
    if (!ids.has(id))
      report(
        "MISSING_REFERENCE",
        path,
        `Referenced ${kind} "${id}" does not exist.`,
      );
  };
  document.elements.forEach((element, i) => {
    Object.entries(element.terminals).forEach(([role, terminal]) => {
      const path = `/elements/${i}/terminals/${pointer(role)}`;
      if (terminalIds.has(terminal.id))
        report(
          "DUPLICATE_ID",
          `${path}/id`,
          `Duplicate terminal ID "${terminal.id}".`,
        );
      terminalIds.add(terminal.id);
      if (terminal.connection_point.status === "known") {
        expectReference(
          points,
          terminal.connection_point.value,
          `${path}/connection_point/value`,
          "connectivity point",
        );
      }
    });
  });
  document.source_files.forEach((file, fi) => {
    const pages = new Set<number>();
    file.pages.forEach((page, pi) => {
      const path = `/source_files/${fi}/pages/${pi}`;
      if (pages.has(page.page))
        report(
          "DUPLICATE_ID",
          `${path}/page`,
          `Duplicate page number ${page.page}.`,
        );
      pages.add(page.page);
      unique(page.text_spans, `${path}/text_spans`);
      page.tiles.forEach((tile, ti) => {
        if (tileIds.has(tile.id))
          report(
            "DUPLICATE_ID",
            `${path}/tiles/${ti}/id`,
            `Duplicate tile ID "${tile.id}".`,
          );
        tileIds.add(tile.id);
        if (tile.extraction_run_id !== null)
          expectReference(
            runs,
            tile.extraction_run_id,
            `${path}/tiles/${ti}/extraction_run_id`,
            "extraction run",
          );
      });
    });
  });
  document.extraction.observations.forEach((observation, i) => {
    expectReference(
      tileIds,
      observation.tile_id,
      `/extraction/observations/${i}/tile_id`,
      "tile",
    );
    observation.terminals.forEach((terminal, ti) => {
      const path = `/extraction/observations/${i}/terminals/${ti}`;
      expectReference(
        observations,
        terminal.observation_id,
        `${path}/observation_id`,
        "observation",
      );
      if (
        terminal.attached_observation_id.status === "known" &&
        terminal.attached_observation_id.value !== null
      ) {
        expectReference(
          observations,
          terminal.attached_observation_id.value,
          `${path}/attached_observation_id/value`,
          "observation",
        );
      }
    });
  });
  document.extraction.merge_decisions.forEach((decision, i) => {
    decision.observation_ids.forEach((id, j) =>
      expectReference(
        observations,
        id,
        `/extraction/merge_decisions/${i}/observation_ids/${j}`,
        "observation",
      ),
    );
  });
  if (document.settings.slack_element_id.status === "known") {
    expectReference(
      elements,
      document.settings.slack_element_id.value,
      "/settings/slack_element_id/value",
      "slack element",
    );
  }
  document.review.unresolved_element_ids.forEach((id, i) =>
    expectReference(
      elements,
      id,
      `/review/unresolved_element_ids/${i}`,
      "element",
    ),
  );
  document.operation.island_policy.authorized_isolated_element_ids.forEach(
    (id, i) =>
      expectReference(
        elements,
        id,
        `/operation/island_policy/authorized_isolated_element_ids/${i}`,
        "element",
      ),
  );
  document.operation.island_policy.energized_island_slacks.forEach(
    (island, i) => {
      expectReference(
        elements,
        island.slack_element_id,
        `/operation/island_policy/energized_island_slacks/${i}/slack_element_id`,
        "slack element",
      );
      island.connectivity_point_ids.forEach((id, j) =>
        expectReference(
          points,
          id,
          `/operation/island_policy/energized_island_slacks/${i}/connectivity_point_ids/${j}`,
          "connectivity point",
        ),
      );
    },
  );
  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}/${i}`));
      return;
    }
    const object = value as Record<string, unknown>;
    if (
      typeof object.x_min === "number" &&
      typeof object.x_max === "number" &&
      typeof object.y_min === "number" &&
      typeof object.y_max === "number"
    ) {
      if (object.x_min > object.x_max || object.y_min > object.y_max) {
        report(
          "INVALID_BOX",
          path,
          "The minimum source coordinate cannot exceed the maximum.",
        );
      }
    }
    if (
      typeof object.file_id === "string" &&
      typeof object.page === "number" &&
      "bbox" in object
    ) {
      const file = files.get(object.file_id);
      const page = file?.pages.find(
        (candidate) => candidate.page === object.page,
      );
      if (!page)
        report(
          "MISSING_REFERENCE",
          path,
          `Source file/page "${object.file_id}"/${object.page} does not exist.`,
        );
      else if (Array.isArray(object.text_span_ids)) {
        const spanIds = new Set(page.text_spans.map((span) => span.id));
        object.text_span_ids.forEach((id, index) =>
          expectReference(
            spanIds,
            String(id),
            `${path}/text_span_ids/${index}`,
            "text span",
          ),
        );
      }
    }
    if (
      object.source === "drawing" &&
      typeof object.extraction_run_id === "string"
    ) {
      expectReference(
        runs,
        object.extraction_run_id,
        `${path}/extraction_run_id`,
        "extraction run",
      );
    }
    Object.entries(object).forEach(([key, item]) =>
      visit(item, `${path}/${pointer(key)}`),
    );
  };
  visit(document, "");
  const solution = document.solution;
  if (
    solution &&
    (solution.model_revision > document.revision ||
      (solution.model_revision !== document.revision &&
        solution.status !== "superseded"))
  ) {
    report(
      "INVALID_REVISION",
      "/solution/model_revision",
      "A current solution must match the document revision; older runs must be superseded.",
    );
  }
  if (solution && solution.status !== "superseded") {
    solution.energized_point_ids.forEach((id, i) =>
      expectReference(
        points,
        id,
        `/solution/energized_point_ids/${i}`,
        "connectivity point",
      ),
    );
    solution.deenergized_point_ids.forEach((id, i) =>
      expectReference(
        points,
        id,
        `/solution/deenergized_point_ids/${i}`,
        "connectivity point",
      ),
    );
    solution.mappings.forEach((mapping, i) => {
      mapping.canonical_element_ids.forEach((id, j) =>
        expectReference(
          elements,
          id,
          `/solution/mappings/${i}/canonical_element_ids/${j}`,
          "element",
        ),
      );
      mapping.canonical_point_ids.forEach((id, j) =>
        expectReference(
          points,
          id,
          `/solution/mappings/${i}/canonical_point_ids/${j}`,
          "connectivity point",
        ),
      );
      mapping.terminal_ids.forEach((id, j) =>
        expectReference(
          terminalIds,
          id,
          `/solution/mappings/${i}/terminal_ids/${j}`,
          "terminal",
        ),
      );
    });
    if (
      solution.status === "converged" &&
      (!solution.results || !solution.results.system.converged)
    ) {
      report(
        "INVALID_STATE",
        "/solution/results",
        "A converged run requires a converged result set.",
      );
    }
    if (
      solution.status === "nonconverged" &&
      solution.results?.system.converged
    ) {
      report(
        "INVALID_STATE",
        "/solution/results/system/converged",
        "A nonconverged run cannot contain a converged result set.",
      );
    }
    if (solution.results) {
      solution.results.buses.forEach((bus, i) =>
        bus.busbar_ids.forEach((id, j) =>
          expectReference(
            elements,
            id,
            `/solution/results/buses/${i}/busbar_ids/${j}`,
            "busbar",
          ),
        ),
      );
      for (const table of [
        "lines",
        "transformers",
        "generators",
        "external_grids",
        "loads",
        "shunts",
      ] as const) {
        solution.results[table].forEach((row, i) =>
          expectReference(
            elements,
            row.element_id,
            `/solution/results/${table}/${i}/element_id`,
            "element",
          ),
        );
      }
    }
  }
  if (
    document.review.status === "confirmed" &&
    document.review.confirmed_model_revision !== document.revision
  ) {
    report(
      "INVALID_REVISION",
      "/review/confirmed_model_revision",
      "Review confirmation must identify the current revision.",
    );
  }
  return issues;
}

export function validateStudyDocument(input: unknown): ModelValidationResult {
  const jsonIssues = inspectJsonValue(input);
  if (jsonIssues.length) return { valid: false, issues: jsonIssues };
  if (!validateTaggedDocument(input) && !validateSchema(input)) {
    return {
      valid: false,
      issues: (validateSchema.errors ?? []).map((error) => ({
        code: "SCHEMA" as const,
        path: error.instancePath,
        message: `${error.message ?? "Invalid model data."}${error.keyword === "additionalProperties" ? ` (${String(error.params.additionalProperty)})` : ""}`,
      })),
    };
  }
  const issues = inspectStructuralReferences(input);
  return issues.length
    ? { valid: false, issues }
    : { valid: true, document: input };
}

export function assertStudyDocument(
  input: unknown,
): asserts input is StudyDocument {
  const result = validateStudyDocument(input);
  if (!result.valid) throw new ModelValidationError(result.issues);
}

export function parseStudyDocument(text: string): StudyDocument {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new ModelValidationError([
      {
        code: "INVALID_JSON",
        path: "",
        message: "The case file is not valid JSON.",
      },
    ]);
  }
  assertStudyDocument(input);
  return input;
}
