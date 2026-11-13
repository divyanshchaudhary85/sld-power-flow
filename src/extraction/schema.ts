import Ajv from "ajv";
import { DATA_FIELDS } from "./model";
import { ELEMENT_TYPES, type TileResponse } from "./types";

const nullableText = { anyOf: [{ type: "string" }, { type: "null" }] };
const confidence = { type: "number", minimum: 0, maximum: 1 };
const point = {
  type: "array",
  items: { type: "number", minimum: 0, maximum: 1 },
  minItems: 2,
  maxItems: 2,
};
const box = {
  type: "array",
  items: { type: "number", minimum: 0, maximum: 1 },
  minItems: 4,
  maxItems: 4,
};
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const endpoint = object({
  component_id: nullableText,
  terminal_id: nullableText,
});
export const ATTRIBUTE_NAMES = [
  ...new Set(
    Object.values(DATA_FIELDS)
      .flat()
      .concat([
        "in_service",
        "station",
        "bay",
        "notes",
        "tap.side",
        "tap.neutral",
        "tap.min",
        "tap.max",
        "tap.position",
        "tap.step_percent",
        "tap.step_degree",
        "tap.changer_type",
        "tap.ratio_definition",
      ]),
  ),
].sort();
export const extractionSchema = object({
  components: {
    type: "array",
    maxItems: 300,
    items: object({
      id: { type: "string", minLength: 1, maxLength: 80 },
      type: { type: "string", enum: ELEMENT_TYPES },
      label: nullableText,
      bbox: box,
      confidence,
      attributes: {
        type: "array",
        maxItems: 64,
        items: object({
          name: { type: "string", enum: ATTRIBUTE_NAMES },
          number: { anyOf: [{ type: "number" }, { type: "null" }] },
          text: nullableText,
          boolean: { anyOf: [{ type: "boolean" }, { type: "null" }] },
          unit: { type: "string", maxLength: 60 },
          raw_text: { type: "string", maxLength: 500 },
          confidence,
        }),
      },
      terminals: {
        type: "array",
        maxItems: 20,
        items: object({
          id: { type: "string", minLength: 1, maxLength: 80 },
          role: {
            type: "string",
            enum: ["bus", "from", "to", "hv", "lv", "a", "b", "unknown"],
          },
          point,
          confidence,
        }),
      },
    }),
  },
  strokes: {
    type: "array",
    maxItems: 500,
    items: object({
      id: { type: "string", minLength: 1, maxLength: 80 },
      points: { type: "array", minItems: 2, maxItems: 256, items: point },
      from: endpoint,
      to: endpoint,
      confidence,
    }),
  },
  junctions: {
    type: "array",
    maxItems: 300,
    items: object({
      id: { type: "string", minLength: 1, maxLength: 80 },
      point,
      stroke_ids: {
        type: "array",
        minItems: 2,
        maxItems: 20,
        items: { type: "string" },
      },
      confidence,
    }),
  },
  unassociated_text: {
    type: "array",
    maxItems: 300,
    items: object({
      text: { type: "string", maxLength: 1000 },
      bbox: box,
      confidence,
    }),
  },
  regions: object({
    legend: { anyOf: [box, { type: "null" }] },
    title_block: { anyOf: [box, { type: "null" }] },
  }),
  notes: {
    type: "array",
    maxItems: 30,
    items: { type: "string", maxLength: 1000 },
  },
});

const validate = new Ajv({
  allErrors: true,
  strict: true,
}).compile<TileResponse>(extractionSchema);
export class ExtractionResponseError extends Error {
  readonly retryable = true;
}
const orderedBox = (bbox: number[]) => bbox[0] < bbox[2] && bbox[1] < bbox[3];
export function parseTileResponse(value: unknown): TileResponse {
  if (!validate(value))
    throw new ExtractionResponseError(
      "The provider response failed the perception schema.",
    );
  const components = new Map(
    value.components.map((component) => [component.id, component]),
  );
  const strokes = new Set(value.strokes.map((stroke) => stroke.id));
  if (
    components.size !== value.components.length ||
    strokes.size !== value.strokes.length
  )
    throw new ExtractionResponseError("The provider reused local drawing IDs.");
  for (const component of value.components) {
    if (!orderedBox(component.bbox))
      throw new ExtractionResponseError(
        "The provider returned an empty source box.",
      );
    if (
      new Set(component.terminals.map((t) => t.id)).size !==
      component.terminals.length
    )
      throw new ExtractionResponseError("The provider reused terminal IDs.");
    for (const attribute of component.attributes)
      if (
        [attribute.number, attribute.text, attribute.boolean].filter(
          (v) => v !== null,
        ).length !== 1 ||
        !attribute.raw_text.trim()
      ) {
        throw new ExtractionResponseError(
          "Every observed attribute needs one literal value and its printed source text.",
        );
      }
  }
  for (const stroke of value.strokes)
    for (const [index, end] of [stroke.from, stroke.to].entries()) {
      if ((end.component_id === null) !== (end.terminal_id === null))
        throw new ExtractionResponseError(
          "A wire endpoint has an incomplete attachment.",
        );
      if (
        end.component_id !== null &&
        !components
          .get(end.component_id)
          ?.terminals.some((t) => t.id === end.terminal_id)
      ) {
        throw new ExtractionResponseError(
          "A wire endpoint refers to a missing symbol terminal.",
        );
      }
      if (end.component_id !== null) {
        const terminal = components
          .get(end.component_id)!
          .terminals.find((t) => t.id === end.terminal_id)!;
        const endpoint =
          stroke.points[index === 0 ? 0 : stroke.points.length - 1];
        if (
          Math.hypot(
            terminal.point[0] - endpoint[0],
            terminal.point[1] - endpoint[1],
          ) > 0.03
        )
          throw new ExtractionResponseError(
            "A wire attachment contradicts its terminal coordinates.",
          );
      }
    }
  for (const junction of value.junctions)
    if (
      new Set(junction.stroke_ids).size !== junction.stroke_ids.length ||
      junction.stroke_ids.some((id) => !strokes.has(id))
    )
      throw new ExtractionResponseError(
        "A junction refers to an unknown or repeated wire stroke.",
      );
  for (const text of value.unassociated_text)
    if (!orderedBox(text.bbox))
      throw new ExtractionResponseError("A text source box is empty.");
  for (const region of Object.values(value.regions))
    if (region && !orderedBox(region))
      throw new ExtractionResponseError("A page region is empty.");
  return value;
}

export function parseExtractionEnvelope(value: unknown): {
  observation: TileResponse;
  inputTokens: number | null;
  outputTokens: number | null;
} {
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  if (
    !record(value) ||
    value.status !== "completed" ||
    !Array.isArray(value.output)
  )
    throw new ExtractionResponseError(
      "The provider did not complete the tile response.",
    );
  const content = value.output
    .filter(record)
    .flatMap((item) =>
      Array.isArray(item.content) ? item.content.filter(record) : [],
    );
  if (content.some((item) => item.type === "refusal"))
    throw new Error(
      "The provider declined this image. No observations were accepted.",
    );
  const text = content
    .filter((item) => item.type === "output_text")
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExtractionResponseError(
      "The provider returned invalid tile JSON.",
    );
  }
  const usage = record(value.usage) ? value.usage : {};
  return {
    observation: parseTileResponse(parsed),
    inputTokens:
      typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens:
      typeof usage.output_tokens === "number" ? usage.output_tokens : null,
  };
}
