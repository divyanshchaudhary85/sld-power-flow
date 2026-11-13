import type { DrawingRef, Element, FieldNumber } from "../model/types";
import { DATA_FIELDS, drawnField, missing } from "./model";
import { ELEMENT_TYPES, type ElementType, type ReadAttribute } from "./types";

export interface AttributeEvidence {
  attribute: ReadAttribute;
  ref: DrawingRef;
  runId: string;
}
type Literal = string | number | boolean;
const unitKey = (unit: string) =>
  unit
    .trim()
    .toLowerCase()
    .replace(/μ|µ/g, "u")
    .replace(/ω/g, "ohm")
    .replace(/\s/g, "");
const scales: Record<string, Record<string, number>> = {
  kv: { kv: 1, v: 0.001 },
  mw: { mw: 1, kw: 0.001, w: 0.000001 },
  mvar: { mvar: 1, kvar: 0.001, var: 0.000001 },
  mva: { mva: 1, kva: 0.001, va: 0.000001 },
  kw: { kw: 1, w: 0.001, mw: 1000 },
  ka: { ka: 1, a: 0.001 },
  km: { km: 1, m: 0.001 },
  percent: { "%": 1, percent: 1 },
  degree: { deg: 1, degree: 1, degrees: 1, "°": 1 },
  ohm_per_km: { "ohm/km": 1, "ohms/km": 1 },
  us_per_km: { "us/km": 1, "s/km": 1e6 },
  dimensionless: { "": 1, pu: 1, "p.u.": 1, "1": 1, count: 1 },
};
function unitFor(name: string): string {
  for (const suffix of [
    "ohm_per_km",
    "us_per_km",
    "kv",
    "mw",
    "mvar",
    "mva",
    "kw",
    "ka",
    "km",
    "percent",
    "degree",
  ])
    if (name.endsWith(`_${suffix}`)) return suffix;
  return "dimensionless";
}
const integers = new Set([
  "parallel_count",
  "step",
  "max_step",
  "tap.neutral",
  "tap.min",
  "tap.max",
  "tap.position",
]);
function stringValues(
  name: string,
  type: ElementType,
): readonly string[] | null | undefined {
  if (
    [
      "station",
      "bay",
      "notes",
      "raw_symbol_description",
      "raw_label",
      "tap.ratio_definition",
    ].includes(name)
  )
    return null;
  if (name === "possible_type") return ELEMENT_TYPES;
  if (name === "mode")
    return type === "external_grid"
      ? ["slack", "voltage_controlled"]
      : ["pv", "slack"];
  if (name === "technology")
    return type === "shunt"
      ? ["capacitor", "reactor", "other"]
      : ["pv", "storage", "other"];
  if (name === "model")
    return type === "shunt" ? ["constant_impedance"] : ["constant_pq"];
  if (name === "electrical_model") return ["ideal"];
  if (name === "state" || name === "normal_state") return ["open", "closed"];
  if (name === "reactive_kind") return ["leading", "lagging"];
  if (name === "tap.side") return ["hv", "lv"];
  if (name === "tap.changer_type") return ["ratio", "phase_shift"];
  return undefined;
}
/** Unit scaling is deterministic; no unitless physical quantity is silently assigned a unit. */
export function normalizeAttribute(
  attribute: ReadAttribute,
  type: ElementType,
): { value: Literal; factor: number } | null {
  const { name } = attribute;
  if (name === "standard_type" || name === "tap") return null; // Printed names cannot identify a versioned library or tap capability.
  if (name === "in_service")
    return attribute.boolean === null
      ? null
      : { value: attribute.boolean, factor: 1 };
  const values = stringValues(name, type);
  if (values !== undefined) {
    if (attribute.text === null) return null;
    const value = values ? attribute.text.trim().toLowerCase() : attribute.text;
    return !values || values.includes(value) ? { value, factor: 1 } : null;
  }
  if (attribute.number === null) return null;
  const factor = scales[unitFor(name)][unitKey(attribute.unit)];
  if (factor === undefined) return null;
  const value = attribute.number * factor;
  if (
    !Number.isFinite(value) ||
    (integers.has(name) && !Number.isInteger(value))
  )
    return null;
  return { value, factor };
}

/** Conflicting reads remain ambiguous, even when one candidate has higher confidence. */
export function resolveAttribute(
  evidence: AttributeEvidence[],
  type: ElementType,
): unknown {
  const normalized = evidence
    .map((item) => ({
      ...item,
      normalized: normalizeAttribute(item.attribute, type),
    }))
    .filter((item) => item.normalized !== null);
  if (!normalized.length)
    return {
      ...missing(),
      reason: "unreadable",
      evidence: evidence.map((item) => item.ref),
    };
  const candidates = [
    ...new Map(
      normalized.map((item) => [
        JSON.stringify(item.normalized!.value),
        item.normalized!.value,
      ]),
    ).values(),
  ];
  if (candidates.length > 1 || normalized.length !== evidence.length)
    return {
      ...missing(),
      reason: "ambiguous",
      candidates,
      evidence: evidence.map((item) => item.ref),
    };
  const selected = normalized.sort(
    (a, b) => b.attribute.confidence - a.attribute.confidence,
  )[0];
  const field = drawnField(
    selected.normalized!.value,
    selected.attribute.confidence,
    evidence.map((item) => item.ref),
    selected.runId,
  ) as unknown as FieldNumber;
  if (field.status === "known" && selected.normalized!.factor !== 1)
    field.derivation = {
      rule_id: "literal-unit-scaling",
      rule_version: "1",
      input_paths: [],
      description: `Printed ${selected.attribute.raw_text}; multiply ${selected.attribute.unit} by ${selected.normalized!.factor} to the canonical unit.`,
    };
  return field;
}

export function populateAttributes(
  element: Element,
  evidence: AttributeEvidence[],
): void {
  const type = element.type.value;
  const groups = new Map<string, AttributeEvidence[]>();
  for (const item of evidence)
    groups.set(item.attribute.name, [
      ...(groups.get(item.attribute.name) ?? []),
      item,
    ]);
  const row = element as unknown as Record<string, unknown>,
    data = element.data as unknown as Record<string, unknown>;
  for (const [name, items] of groups) {
    if (["in_service", "station", "bay", "notes"].includes(name))
      row[name] = resolveAttribute(items, type);
    else if (
      DATA_FIELDS[type].includes(name) &&
      name !== "tap" &&
      name !== "standard_type"
    )
      data[name] = resolveAttribute(items, type);
  }
  // Seeing any explicit tap attribute establishes a fixed tap capability, not its missing parameters.
  const taps = [...groups].filter(([key]) => key.startsWith("tap."));
  if (type === "transformer_2w" && taps.length) {
    const tap: Record<string, unknown> = { kind: "fixed" };
    for (const name of [
      "side",
      "neutral",
      "min",
      "max",
      "position",
      "step_percent",
      "step_degree",
      "changer_type",
      "ratio_definition",
    ]) {
      const items = groups.get(`tap.${name}`);
      tap[name] = items ? resolveAttribute(items, type) : missing();
    }
    data.tap = drawnField(
      tap,
      Math.min(
        ...taps.flatMap(([, items]) =>
          items.map((item) => item.attribute.confidence),
        ),
      ),
      taps.flatMap(([, items]) => items.map((item) => item.ref)),
      taps[0][1][0].runId,
    );
  }
}
