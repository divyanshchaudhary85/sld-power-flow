import template from "../../schema/fixture-template.json";
import { assertStudyDocument } from "../model/validation";
import type {
  DrawingRef,
  Element,
  FieldNumber,
  Provenance,
  SourceRef,
  StudyDocument,
} from "../model/types";
import type { ElementType } from "./types";

export const missing = () => ({
  status: "missing" as const,
  reason: "not_shown" as const,
  candidates: [],
  evidence: [],
});
export const userField = <T>(value: T, at = new Date().toISOString()) => ({
  status: "known" as const,
  value,
  provenance: {
    source: "user" as const,
    changed_at: at,
    supersedes_path: null,
    evidence: [],
  },
  derivation: null,
});
export const drawnField = <T>(
  value: T,
  confidence: number,
  refs: DrawingRef[],
  runId: string,
) => ({
  status: "known" as const,
  value,
  provenance: {
    source: "drawing" as const,
    confidence,
    evidence: refs,
    extraction_run_id: runId,
    reviewed: false,
  },
  derivation: null,
});

export interface DraftOptions {
  caseName?: string;
  networkType?: "transmission_subtransmission" | "industrial" | "distribution";
  frequencyHz?: 50 | 60;
  symbolSet?: "IEC" | "ANSI_IEEE";
  origin?: "uploaded" | "manual";
}
export function createDraft(options: DraftOptions = {}): StudyDocument {
  const draft = structuredClone(template) as StudyDocument,
    at = new Date().toISOString();
  draft.case_id = crypto.randomUUID();
  draft.revision = 0;
  draft.meta = {
    name: userField(options.caseName ?? "Untitled study", at),
    network_type: options.networkType
      ? userField(options.networkType, at)
      : missing(),
    frequency_hz: options.frequencyHz
      ? userField(options.frequencyHz, at)
      : missing(),
    symbol_set: options.symbolSet
      ? userField(options.symbolSet, at)
      : missing(),
    base_mva: missing(),
    case_origin: userField(options.origin ?? "manual", at),
    description: userField(null, at),
    created_at: at,
    modified_at: at,
    fixture_id: null,
    source_case_hash: null,
  };
  draft.data_suggestions = [];
  const settings = draft.settings as unknown as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(settings)) {
    if (candidate && typeof candidate === "object" && "status" in candidate) {
      const field = candidate as FieldNumber;
      if (
        field.status === "known" &&
        !["slack_confirmed", "base_confirmed"].includes(key)
      )
        draft.data_suggestions.push({
          id: `study-setting-${key}`,
          target_path: `/settings/${key}`,
          candidate_value: field.value,
          source: "default",
          source_id: "study-settings-v1",
          source_version: "1",
          rationale:
            "Suggested starting study setting. Review and accept explicitly before use.",
          status: "offered",
        });
      settings[key] = missing();
    }
  }
  draft.source_files = [];
  draft.elements = [];
  draft.connectivity_points = [];
  draft.extraction = {
    runs: [],
    observations: [],
    unassociated_text: [],
    unresolved_endpoints: [],
    merge_decisions: [],
    annotations: [],
  };
  draft.review = {
    status: "pending",
    confirmed_model_revision: null,
    confirmed_input_hash: null,
    confirmed_at: null,
    unresolved_element_ids: [],
    decisions: [],
  };
  draft.solution = null;
  draft.validation = null;
  draft.export_history = [];
  draft.operation.base_snapshot = null;
  draft.operation.events = [];
  draft.operation.acknowledgements = [];
  assertStudyDocument(draft);
  return draft;
}

export const TERMINALS: Record<ElementType, string[]> = {
  busbar: ["bus"],
  line: ["from", "to"],
  cable: ["from", "to"],
  transformer_2w: ["hv", "lv"],
  external_grid: ["bus"],
  generator: ["bus"],
  static_generator: ["bus"],
  load: ["bus"],
  motor: ["bus"],
  shunt: ["bus"],
  circuit_breaker: ["a", "b"],
  disconnector: ["a", "b"],
  fuse: ["a", "b"],
  unknown: [],
};
export const DATA_FIELDS: Record<ElementType, string[]> = {
  busbar: ["nominal_kv", "voltage_min_pu", "voltage_max_pu"],
  line: [
    "length_km",
    "r_ohm_per_km",
    "x_ohm_per_km",
    "b_us_per_km",
    "g_us_per_km",
    "max_current_ka",
    "derating_factor",
    "parallel_count",
    "standard_type",
    "from_nominal_kv",
    "to_nominal_kv",
  ],
  cable: [
    "length_km",
    "r_ohm_per_km",
    "x_ohm_per_km",
    "b_us_per_km",
    "g_us_per_km",
    "max_current_ka",
    "derating_factor",
    "parallel_count",
    "standard_type",
    "from_nominal_kv",
    "to_nominal_kv",
  ],
  transformer_2w: [
    "sn_mva",
    "vn_hv_kv",
    "vn_lv_kv",
    "vk_percent",
    "vkr_percent",
    "pfe_kw",
    "i0_percent",
    "phase_shift_degree",
    "derating_factor",
    "parallel_count",
    "standard_type",
    "tap",
  ],
  external_grid: [
    "voltage_setpoint_kv",
    "angle_degree",
    "infeed_rating_mva",
    "p_dispatch_mw",
    "min_p_mw",
    "max_p_mw",
    "min_q_mvar",
    "max_q_mvar",
    "mode",
  ],
  generator: [
    "p_mw",
    "voltage_setpoint_kv",
    "sn_mva",
    "min_p_mw",
    "max_p_mw",
    "min_q_mvar",
    "max_q_mvar",
    "mode",
    "slack_angle_degree",
  ],
  static_generator: [
    "p_mw",
    "q_mvar",
    "sn_mva",
    "min_p_mw",
    "max_p_mw",
    "min_q_mvar",
    "max_q_mvar",
    "technology",
  ],
  load: [
    "p_mw",
    "q_mvar",
    "scaling_factor",
    "sn_mva",
    "power_factor",
    "reactive_kind",
    "model",
  ],
  motor: [
    "p_mw",
    "q_mvar",
    "scaling_factor",
    "sn_mva",
    "power_factor",
    "reactive_kind",
    "model",
  ],
  shunt: [
    "p_mw",
    "q_mvar",
    "nominal_kv",
    "step",
    "max_step",
    "technology",
    "model",
  ],
  circuit_breaker: [
    "state",
    "normal_state",
    "rated_current_ka",
    "rated_voltage_kv",
    "electrical_model",
  ],
  disconnector: [
    "state",
    "normal_state",
    "rated_current_ka",
    "rated_voltage_kv",
    "electrical_model",
  ],
  fuse: [
    "state",
    "normal_state",
    "rated_current_ka",
    "rated_voltage_kv",
    "electrical_model",
  ],
  unknown: ["raw_symbol_description", "raw_label", "possible_type"],
};

/** User-added elements begin incomplete. No operating status or electrical data is assumed. */
export function createElement(
  type: ElementType,
  id: string,
  doc?: StudyDocument,
): Element {
  if (!Object.hasOwn(DATA_FIELDS, type) || !id.trim())
    throw new Error("Choose a supported element type and non-empty ID.");
  const at = new Date().toISOString();
  const source: SourceRef = {
    kind: "user_added",
    created_at: at,
    manually_marked_region: null,
  };
  const row = {
    id,
    type: userField(type, at),
    label: userField(id, at),
    in_service: missing(),
    source_ref: source,
    layout: {
      position: {
        x: 100 + ((doc?.elements.length ?? 0) % 6) * 120,
        y: 100 + Math.floor((doc?.elements.length ?? 0) / 6) * 120,
      },
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
    station: missing(),
    bay: missing(),
    notes: missing(),
    terminals: Object.fromEntries(
      TERMINALS[type].map((role) => [
        role,
        {
          id: `${id}:${role}`,
          role,
          connection_point: missing(),
          source_ref: source,
          drawn_anchor: null,
        },
      ]),
    ),
    data: Object.fromEntries(DATA_FIELDS[type].map((key) => [key, missing()])),
  };
  return row as unknown as Element;
}

/** Retyping keeps identity and source evidence; engineering attributes need fresh review. */
export function retypeElement(
  element: Element,
  type: ElementType,
  doc?: StudyDocument,
): Element {
  const next = createElement(type, element.id, doc);
  next.label = structuredClone(element.label);
  next.in_service = structuredClone(element.in_service);
  next.source_ref = structuredClone(element.source_ref);
  next.layout = structuredClone(element.layout);
  next.station = structuredClone(element.station);
  next.bay = structuredClone(element.bay);
  next.notes = structuredClone(element.notes);
  // Connections and engineering attributes require review after a semantic retype.
  return next;
}

export function withDrawingSource(
  element: Element,
  ref: DrawingRef,
  runId: string,
  confidence: number,
): void {
  element.source_ref = { kind: "drawing", primary: ref, evidence: [ref] };
  element.type = drawnField(
    element.type.value,
    confidence,
    [ref],
    runId,
  ) as Element["type"];
  element.layout.position = {
    x: (ref.bbox.x_min + ref.bbox.x_max) / 2,
    y: (ref.bbox.y_min + ref.bbox.y_max) / 2,
  };
  element.layout.width = ref.bbox.x_max - ref.bbox.x_min;
  element.layout.height = ref.bbox.y_max - ref.bbox.y_min;
  element.layout.page_group = `${ref.file_id}:${ref.page}`;
  for (const terminal of Object.values(element.terminals))
    terminal.source_ref = structuredClone(element.source_ref);
}

export const sourceProvenance = (
  ref: DrawingRef,
  runId: string,
  confidence: number,
): Provenance => ({
  source: "drawing",
  confidence,
  evidence: [ref],
  extraction_run_id: runId,
  reviewed: false,
});
