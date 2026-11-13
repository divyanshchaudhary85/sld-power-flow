import type {
  DrawingRef,
  Element,
  Finding,
  StudyDocument,
} from "../model/types";
import { listMissingData } from "../completion/missing";
import { analyzeTopology, reachableNodes } from "./topology";
import type { TopologyAnalysis } from "./topology";
import {
  active,
  dataOf,
  fieldValue,
  isBranch,
  isSource,
  isSwitch,
  numberOf,
  numberValue,
  sourceLocations,
} from "./values";
export { analyzeTopology, reachableNodes } from "./topology";
export type {
  TopologyAnalysis,
  TopologyComponent,
  TopologyNode,
} from "./topology";

export const RULE_IDS = [
  "D01",
  "D02",
  "D03",
  "D04",
  "D05",
  "T01",
  "T02",
  "T03",
  "T04",
  "E01",
  "E02",
  "E03",
  "E04",
  "E05",
  "E06",
  "E07",
  "C01",
  "C02",
  "P01",
  "P02",
  "P03",
  "P04",
  "P05",
  "P06",
] as const;
export type RuleId = (typeof RULE_IDS)[number];
interface Context {
  document: StudyDocument;
  topology: TopologyAnalysis;
}
type Rule = (context: Context) => Finding[];
const version = "1.0.0";
function threshold(
  document: StudyDocument,
  rule: string,
  parameter: string,
  fallback: number,
): number {
  return (
    numberValue(
      document.settings.additional_rule_thresholds.find(
        (entry) => entry.rule_id === rule && entry.parameter_name === parameter,
      )?.value,
    ) ?? fallback
  );
}
function finding(
  context: Context,
  rule: RuleId,
  severity: Finding["severity"],
  message: string,
  elementIds: string[],
  fix: string,
  options: {
    paths?: string[];
    locations?: DrawingRef[];
    value?: number;
    limit?: number;
    unit?: string;
    blocks?: boolean;
  } = {},
): Finding {
  const stage: Finding["stage"] = rule.startsWith("D")
    ? "drawing"
    : rule.startsWith("T")
      ? "topology"
      : rule.startsWith("E")
        ? "electrical"
        : rule.startsWith("C")
          ? "completeness"
          : "post_solve";
  const locations =
    options.locations ??
    context.document.elements
      .filter((element) => elementIds.includes(element.id))
      .flatMap((element) => sourceLocations(element.source_ref));
  return {
    id: `${rule}:${encodeURIComponent(elementIds.join("|"))}:${encodeURIComponent((options.paths ?? []).join("|"))}`,
    rule_id: rule,
    rule_version: version,
    stage,
    severity,
    blocks_solve:
      options.blocks ?? (stage !== "post_solve" && severity === "error"),
    message,
    element_ids: elementIds,
    field_paths: options.paths ?? [],
    locations,
    suggested_fix: fix,
    observed_value:
      options.value === undefined
        ? null
        : { value: options.value, unit: options.unit ?? "" },
    limit:
      options.limit === undefined
        ? null
        : { value: options.limit, unit: options.unit ?? "" },
    model_revision: context.document.revision,
    solution_run_id:
      stage === "post_solve" ? (context.document.solution?.id ?? null) : null,
    status: "active",
    cause_finding_ids: [],
  };
}
const pathOf = (document: StudyDocument, element: Element, key: string) =>
  `/elements/${document.elements.indexOf(element)}/data/${key}`;
const currentSolution = (document: StudyDocument) =>
  document.solution?.model_revision === document.revision &&
  document.solution.status !== "superseded"
    ? document.solution
    : null;
const validEnds = (context: Context, element: Element) =>
  Object.values(context.topology.terminalNodes[element.id] ?? {});
const terminalKv = (
  context: Context,
  element: Element,
  role: string,
): number | undefined => {
  const node = context.topology.nodes.find(
    (node) => node.id === context.topology.terminalNodes[element.id]?.[role],
  );
  if (!node) return undefined;
  const busValues = context.document.elements
    .filter((bus) => node.busbarIds.includes(bus.id))
    .map((bus) => numberOf(bus, "nominal_kv"))
    .filter((v): v is number => v !== undefined);
  return busValues.length ? busValues[0] : (node.nominalKv ?? undefined);
};
const mismatch = (
  a: number | undefined,
  b: number | undefined,
  percent: number,
) =>
  a !== undefined &&
  b !== undefined &&
  Math.abs(a - b) > (Math.max(Math.abs(a), Math.abs(b)) * percent) / 100;

const rules: Record<RuleId, Rule> = {
  D01: (context) =>
    context.document.elements.flatMap((element) => {
      const unreadable =
        element.label.status === "missing" &&
        ["unreadable", "ambiguous"].includes(element.label.reason);
      return element.type.value === "unknown" || unreadable
        ? [
            finding(
              context,
              "D01",
              "warning",
              element.type.value === "unknown"
                ? `${element.id}: symbol is not recognized.`
                : `${element.id}: label is unreadable.`,
              [element.id],
              "Review the source region and enter the correct symbol type or label.",
            ),
          ]
        : [];
    }),
  D02: (context) => {
    const counts = new Map<string, number>();
    context.document.elements.forEach((element) =>
      counts.set(element.id, (counts.get(element.id) ?? 0) + 1),
    );
    return [...counts]
      .filter(([, count]) => count > 1)
      .map(([id]) =>
        finding(
          context,
          "D02",
          "error",
          `Two or more elements share ID ${id}.`,
          [id],
          "Assign a distinct stable ID and repair references.",
        ),
      );
  },
  D03: (context) =>
    context.document.extraction.unresolved_endpoints
      .filter(
        (endpoint) => fieldValue(endpoint.attached_observation_id) == null,
      )
      .map((endpoint) =>
        finding(
          context,
          "D03",
          "error",
          `Drawing line endpoint ${endpoint.id} is not attached to a symbol or junction.`,
          [],
          "Reconnect the endpoint in the drawing review.",
          {
            paths: [
              `/extraction/unresolved_endpoints/${context.document.extraction.unresolved_endpoints.indexOf(endpoint)}`,
            ],
            locations: [endpoint.source_ref],
          },
        ),
      ),
  D04: (context) =>
    context.document.extraction.unassociated_text
      .filter((text) => fieldValue(text.associated_element_id) == null)
      .map((text) =>
        finding(
          context,
          "D04",
          "info",
          `Drawing text ${text.id} is not associated with equipment.`,
          [],
          "Associate the text or mark it as an annotation.",
          {
            paths: [
              `/extraction/unassociated_text/${context.document.extraction.unassociated_text.indexOf(text)}`,
            ],
            locations: [text.source_ref],
          },
        ),
      ),
  D05: (context) => {
    const limit =
      numberValue(context.document.settings.low_confidence_threshold) ?? 0.85;
    const globallyReviewed =
      context.document.review.status === "confirmed" &&
      context.document.review.confirmed_model_revision ===
        context.document.revision;
    return context.document.elements.flatMap((element) => {
      if (globallyReviewed || element.review.status === "confirmed") return [];
      const low: number[] = [];
      const visit = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const object = value as Record<string, unknown>;
        if (
          object.status === "known" &&
          object.provenance &&
          typeof object.provenance === "object"
        ) {
          const p = object.provenance as {
            source?: string;
            confidence?: number;
            reviewed?: boolean;
          };
          if (
            p.source === "drawing" &&
            p.confidence !== undefined &&
            p.confidence < limit &&
            !p.reviewed
          )
            low.push(p.confidence);
        }
        Object.values(object).forEach(visit);
      };
      visit(element);
      return low.length
        ? [
            finding(
              context,
              "D05",
              "warning",
              `${element.id}: low-confidence extraction has not been reviewed.`,
              [element.id],
              "Inspect the highlighted source and confirm or correct the element.",
              { value: Math.min(...low), limit },
            ),
          ]
        : [];
    });
  },
  T01: (context) =>
    context.document.elements.some(
      (element) => active(element) && isSource(element),
    )
      ? []
      : [
          finding(
            context,
            "T01",
            "error",
            "No in-service grid or synchronous source exists in the network.",
            [],
            "Add or enable a source and choose its slack role.",
          ),
        ],
  T02: (context) =>
    context.topology.components.flatMap((component) => {
      const equipment = component.elementIds.filter((id) => {
        const element = context.document.elements.find(
          (element) => element.id === id,
        )!;
        return !isSwitch(element);
      });
      if (!equipment.length || component.energized) return [];
      return [
        finding(
          context,
          "T02",
          "error",
          component.intentionalOutage
            ? "Intentional outage: this section is de-energized and excluded from the energized solve."
            : "This in-service island has no path to a confirmed slack source.",
          equipment,
          component.intentionalOutage
            ? "Restore its supply to re-energize it; retained demand is reported as unserved."
            : "Reconnect the island or confirm a valid grid-forming slack for it.",
          { blocks: !component.intentionalOutage },
        ),
      ];
    }),
  T03: (context) =>
    context.document.elements
      .filter(
        (element) =>
          (isBranch(element) || isSwitch(element)) &&
          validEnds(context, element).length !== 2,
      )
      .map((element) =>
        finding(
          context,
          "T03",
          "error",
          `${element.id}: a two-terminal element is not connected at both ends.`,
          [element.id],
          "Connect both terminals to valid connectivity points.",
        ),
      ),
  T04: (context) =>
    context.document.elements
      .filter((element) => element.type.value === "busbar")
      .flatMap((bus) => {
        const node = context.topology.terminalNodes[bus.id]?.bus;
        const connected =
          node &&
          context.document.elements.some(
            (other) =>
              other.id !== bus.id &&
              other.type.value !== "busbar" &&
              validEnds(context, other).includes(node),
          );
        return connected
          ? []
          : [
              finding(
                context,
                "T04",
                "warning",
                `${bus.id}: busbar has no connected equipment.`,
                [bus.id],
                "Connect equipment or remove the unused busbar.",
              ),
            ];
      }),
  E01: (context) => {
    const percent =
      numberValue(
        context.document.settings.nominal_voltage_tolerance_percent,
      ) ?? 1;
    return context.document.elements
      .filter(
        (element) =>
          ["line", "cable"].includes(element.type.value) ||
          (isSwitch(element) &&
            active(element) &&
            fieldValue(dataOf(element).state) === "closed"),
      )
      .flatMap((element) => {
        const roles = Object.keys(element.terminals);
        const a = terminalKv(context, element, roles[0]),
          b = terminalKv(context, element, roles[1]);
        const node = context.topology.nodes.find(
          (node) => node.id === validEnds(context, element)[0],
        );
        const mergedConflict =
          isSwitch(element) &&
          !!node &&
          node.nominalKvValues.some((v) =>
            mismatch(v, node.nominalKvValues[0], percent),
          );
        return mismatch(a, b, percent) || mergedConflict
          ? [
              finding(
                context,
                "E01",
                "error",
                `${element.id}: line or closed switch joins different nominal voltage levels.`,
                [element.id],
                "Correct the bus voltage or use a transformer between voltage levels.",
              ),
            ]
          : [];
      });
  },
  E02: (context) =>
    context.document.elements
      .filter((element) => element.type.value === "transformer_2w")
      .flatMap((element) => {
        const hv = numberOf(element, "vn_hv_kv"),
          lv = numberOf(element, "vn_lv_kv");
        const tolerance =
          numberValue(
            context.document.settings.nominal_voltage_tolerance_percent,
          ) ?? 1;
        return (hv !== undefined && lv !== undefined && hv < lv) ||
          mismatch(hv, terminalKv(context, element, "hv"), tolerance) ||
          mismatch(lv, terminalKv(context, element, "lv"), tolerance)
          ? [
              finding(
                context,
                "E02",
                "error",
                `${element.id}: winding voltages do not match connected buses, or HV/LV are reversed.`,
                [element.id],
                "Match each winding voltage and terminal to its bus.",
              ),
            ]
          : [];
      }),
  E03: (context) =>
    context.document.elements.flatMap((element) => {
      const findings: Finding[] = [];
      const add = (
        key: string,
        message: string,
        value: number,
        limit?: number,
      ) =>
        findings.push(
          finding(
            context,
            "E03",
            "warning",
            `${element.id}: ${message}`,
            [element.id],
            "Verify the nameplate, units and physical range.",
            { paths: [pathOf(context.document, element, key)], value, limit },
          ),
        );
      const pf = numberOf(element, "power_factor"),
        maxPf = threshold(context.document, "E03", "max_power_factor", 1);
      if (pf !== undefined && (pf < 0 || pf > maxPf))
        add(
          "power_factor",
          "power factor is outside the allowed range.",
          pf,
          maxPf,
        );
      if (["line", "cable"].includes(element.type.value)) {
        const length = numberOf(element, "length_km"),
          r = numberOf(element, "r_ohm_per_km"),
          x = numberOf(element, "x_ohm_per_km");
        if (
          length !== undefined &&
          length <= threshold(context.document, "E03", "min_length_km", 0)
        )
          add("length_km", "line length is zero or negative.", length, 0);
        if (r !== undefined && r < 0)
          add("r_ohm_per_km", "line resistance is negative.", r, 0);
        if (x !== undefined && x < 0)
          add("x_ohm_per_km", "line reactance is negative.", x, 0);
        if (
          r !== undefined &&
          x !== undefined &&
          Math.hypot(r, x) <=
            threshold(context.document, "E03", "min_impedance_ohm_per_km", 0)
        )
          add("x_ohm_per_km", "series impedance is zero.", Math.hypot(r, x), 0);
      }
      const z = numberOf(element, "vk_percent");
      const lower =
          numberValue(context.document.settings.transformer_z_min_percent) ?? 2,
        upper =
          numberValue(context.document.settings.transformer_z_max_percent) ??
          25;
      if (z !== undefined && (z < lower || z > upper))
        add(
          "vk_percent",
          `transformer impedance is outside ${lower}–${upper}%.`,
          z,
          z < lower ? lower : upper,
        );
      return findings;
    }),
  E04: (context) =>
    context.document.elements.flatMap((element) => {
      const result: Finding[] = [];
      const networkType = fieldValue(context.document.meta.network_type);
      const ratingCeiling =
        networkType === "distribution"
          ? 100
          : networkType === "industrial"
            ? 1000
            : 10000;
      for (const [key, input] of Object.entries(dataOf(element))) {
        const value = numberValue(input);
        if (value === undefined) continue;
        const voltage = key.endsWith("_kv"),
          power = ["sn_mva", "infeed_rating_mva"].includes(key);
        const max = voltage
          ? threshold(context.document, "E04", "max_nominal_kv", 1200)
          : threshold(context.document, "E04", "max_rating_mva", ratingCeiling);
        if ((voltage || power) && value > max)
          result.push(
            finding(
              context,
              "E04",
              "warning",
              `${element.id}: probable unit slip in ${key}; check ${voltage ? "V versus kV" : "kVA versus MVA"}.`,
              [element.id],
              "Read the original unit and enter the value in the field’s stated engineering unit.",
              {
                paths: [pathOf(context.document, element, key)],
                value,
                limit: max,
                unit: voltage ? "kV" : "MVA",
              },
            ),
          );
      }
      return result;
    }),
  E05: (context) =>
    context.document.elements
      .filter(
        (element) =>
          element.type.value === "circuit_breaker" && active(element),
      )
      .flatMap((breaker) => {
        const rating = numberOf(breaker, "rated_current_ka");
        if (rating === undefined) return [];
        const cut = analyzeTopology(context.document, [breaker.id]);
        const ends = Object.values(cut.terminalNodes[breaker.id]);
        if (ends.length !== 2) return [];
        // A directly attached rated device gives an unambiguous continuous-current comparison.
        const candidates = context.document.elements.filter(
          (element) =>
            active(element) &&
            !isSwitch(element) &&
            element.type.value !== "busbar" &&
            element.id !== breaker.id,
        );
        const result: Finding[] = [];
        for (const equipment of candidates) {
          const terminals = cut.terminalNodes[equipment.id];
          const role = Object.keys(terminals).find(
            (role) =>
              ends.includes(terminals[role]) &&
              (!cut.nodes.find((node) => node.id === terminals[role])?.busbarIds
                .length ||
                !cut.components.find((component) =>
                  component.nodeIds.includes(terminals[role]),
                )?.energized),
          );
          if (!role) continue;
          const s = numberOf(equipment, "sn_mva");
          const kv =
            equipment.type.value === "transformer_2w"
              ? numberOf(equipment, role === "hv" ? "vn_hv_kv" : "vn_lv_kv")
              : cut.nodes.find((node) => node.id === terminals[role])
                  ?.nominalKv;
          if (s === undefined || !kv || s <= 0) continue;
          const parallel =
            equipment.type.value === "transformer_2w"
              ? numberOf(equipment, "parallel_count")
              : 1;
          if (parallel === undefined) continue;
          const required = (s * parallel) / (Math.sqrt(3) * kv);
          if (rating < required)
            result.push(
              finding(
                context,
                "E05",
                "warning",
                `${breaker.id}: continuous current rating is below ${equipment.id}'s nameplate full-load current.`,
                [breaker.id, equipment.id],
                "Check breaker continuous rating, connected equipment rating and voltage.",
                { value: rating, limit: required, unit: "kA" },
              ),
            );
        }
        return result;
      }),
  E06: (context) =>
    context.document.elements
      .filter(
        (element) => element.type.value === "transformer_2w" && active(element),
      )
      .flatMap((transformer) => {
        const terminals = context.topology.terminalNodes[transformer.id];
        const rating = numberOf(transformer, "sn_mva");
        if (!terminals.hv || !terminals.lv || !rating) return [];
        const downstream = reachableNodes(
          context.topology.adjacency,
          terminals.lv,
          transformer.id,
        );
        if (downstream.has(terminals.hv)) return []; // Meshed/parallel supply: loading must come from the AC solve.
        let p = 0,
          q = 0;
        const loads: string[] = [];
        for (const load of context.document.elements.filter(
          (element) =>
            active(element) && ["load", "motor"].includes(element.type.value),
        )) {
          if (!downstream.has(context.topology.terminalNodes[load.id]?.bus))
            continue;
          const lp = numberOf(load, "p_mw"),
            lq = numberOf(load, "q_mvar"),
            scale = numberOf(load, "scaling_factor");
          if (lp === undefined || lq === undefined || scale === undefined)
            continue;
          p += lp * scale;
          q += lq * scale;
          loads.push(load.id);
        }
        const parallel = numberOf(transformer, "parallel_count"),
          derating = numberOf(transformer, "derating_factor");
        if (parallel === undefined || derating === undefined) return [];
        const apparent = Math.hypot(p, q),
          capacity = rating * parallel * derating;
        return apparent > capacity
          ? [
              finding(
                context,
                "E06",
                "warning",
                `${transformer.id}: connected downstream demand exceeds its nameplate capacity.`,
                [transformer.id, ...loads],
                "Review demand/diversity and transformer capacity; solve to inspect actual loading.",
                { value: apparent, limit: capacity, unit: "MVA" },
              ),
            ]
          : [];
      }),
  E07: (context) =>
    context.document.elements
      .filter(
        (element) =>
          active(element) &&
          ["generator", "static_generator"].includes(element.type.value),
      )
      .flatMap((element) => {
        const p = numberOf(element, "p_mw"),
          rating = numberOf(element, "sn_mva"),
          max = numberOf(element, "max_p_mw");
        if (p === undefined) return [];
        const exceedsRating = rating !== undefined && Math.abs(p) > rating,
          exceedsMax = max !== undefined && p > max;
        return exceedsRating || exceedsMax
          ? [
              finding(
                context,
                "E07",
                "error",
                `${element.id}: active-power dispatch exceeds the declared rating or dispatch limit.`,
                [element.id],
                "Reduce dispatch or correct its rating and capability limits.",
                { value: p, limit: exceedsMax ? max : rating, unit: "MW" },
              ),
            ]
          : [];
      }),
  C01: (context) =>
    listMissingData(context.document, context.topology)
      .filter((item) => !item.path.includes("/slack_"))
      .map((item) =>
        finding(
          context,
          "C01",
          "error",
          `${item.elementId ?? "Case"}: ${item.label} must be ${item.kind === "confirmation" ? "confirmed" : "completed"} before solving.`,
          item.elementId ? [item.elementId] : [],
          "Enter a value, choose a standard type, or explicitly accept an available default.",
          { paths: [item.path] },
        ),
      ),
  C02: (context) => {
    const selected = fieldValue<string>(
      context.document.settings.slack_element_id,
    );
    const element = context.document.elements.find(
      (element) => element.id === selected,
    );
    const invalid =
      !element ||
      !isSource(element) ||
      !active(element) ||
      fieldValue(dataOf(element).mode) !== "slack" ||
      fieldValue(context.document.settings.slack_confirmed) !== true;
    const multiple = context.topology.components.filter(
      (component) => component.slackIds.length > 1,
    );
    const results = invalid
      ? [
          finding(
            context,
            "C02",
            "error",
            "No valid slack source has been chosen and confirmed.",
            element ? [element.id] : [],
            "Select and confirm an in-service grid or synchronous reference source in slack mode.",
            {
              paths: [
                "/settings/slack_element_id",
                "/settings/slack_confirmed",
              ],
            },
          ),
        ]
      : [];
    for (const component of multiple)
      results.push(
        finding(
          context,
          "C02",
          "error",
          "An energized island has more than one selected slack source.",
          component.slackIds,
          "Select exactly one reference source per energized island.",
        ),
      );
    for (const island of context.document.operation.island_policy
      .energized_island_slacks) {
      const source = context.document.elements.find(
        (element) => element.id === island.slack_element_id,
      );
      if (
        !source ||
        !isSource(source) ||
        !active(source) ||
        fieldValue(dataOf(source).mode) !== "slack"
      )
        results.push(
          finding(
            context,
            "C02",
            "error",
            "An island reference is not an active source in slack mode.",
            [island.slack_element_id],
            "Correct the island reference source.",
          ),
        );
    }
    return results;
  },
  P01: (context) =>
    currentSolution(context.document)?.status === "nonconverged"
      ? [
          finding(
            context,
            "P01",
            "error",
            "The AC power flow did not converge.",
            [],
            "Inspect the solver diagnostics, connectivity, impedances and operating setpoints.",
          ),
        ]
      : [],
  P02: (context) => {
    const run = currentSolution(context.document);
    if (run?.status !== "converged") return [];
    return (run.results?.buses ?? []).flatMap((bus, index) => {
      if (bus.voltage_pu.status !== "available") return [];
      const element = context.document.elements.find((element) =>
        bus.busbar_ids.includes(element.id),
      );
      const lower =
        (element && numberOf(element, "voltage_min_pu")) ??
        numberValue(context.document.settings.voltage_min_pu) ??
        0.95;
      const upper =
        (element && numberOf(element, "voltage_max_pu")) ??
        numberValue(context.document.settings.voltage_max_pu) ??
        1.05;
      const value = bus.voltage_pu.value;
      const pointIds = new Set(
        run.mappings.find(
          (mapping) =>
            mapping.solver_kind === "bus" &&
            mapping.solver_id === bus.solver_bus_id,
        )?.canonical_point_ids ?? [],
      );
      const affected = bus.busbar_ids.length
        ? bus.busbar_ids
        : context.document.elements
            .filter((element) =>
              Object.values(element.terminals).some((terminal) =>
                pointIds.has(
                  fieldValue<string>(terminal.connection_point) ?? "",
                ),
              ),
            )
            .map((element) => element.id);
      return value < lower || value > upper
        ? [
            finding(
              context,
              "P02",
              "alarm",
              `Bus voltage is outside ${lower}–${upper} pu.`,
              affected,
              "Review reactive support, tap position and operating conditions.",
              {
                value,
                limit: value < lower ? lower : upper,
                unit: "pu",
                paths: [`/solution/results/buses/${index}/voltage_pu`],
              },
            ),
          ]
        : [];
    });
  },
  P03: (context) => loadingFindings(context, false),
  P04: (context) => loadingFindings(context, true),
  P05: (context) => {
    const run = currentSolution(context.document);
    if (run?.status !== "converged") return [];
    return (run.results?.generators ?? [])
      .filter((generator) => generator.at_q_min || generator.at_q_max)
      .map((generator) => {
        const element = context.document.elements.find(
          (element) => element.id === generator.element_id,
        );
        return finding(
          context,
          "P05",
          "warning",
          `${generator.element_id}: generator has reached a reactive power limit.`,
          [generator.element_id],
          "Review voltage targets and reactive capability.",
          {
            value:
              generator.q_mvar.status === "available"
                ? generator.q_mvar.value
                : undefined,
            limit: element
              ? numberOf(
                  element,
                  generator.at_q_min ? "min_q_mvar" : "max_q_mvar",
                )
              : undefined,
            unit: "MVAr",
          },
        );
      });
  },
  P06: (context) => {
    const run = currentSolution(context.document);
    if (run?.status !== "converged" || !run.results) return [];
    const slackId = fieldValue<string>(
      context.document.settings.slack_element_id,
    );
    const element = context.document.elements.find(
      (element) => element.id === slackId,
    );
    const p = run.results.system.slack_p_mw,
      q = run.results.system.slack_q_mvar;
    if (p.status !== "available") return [];
    const rating = element
      ? numberOf(
          element,
          element.type.value === "external_grid"
            ? "infeed_rating_mva"
            : "sn_mva",
        )
      : undefined;
    const apparent =
      q.status === "available"
        ? Math.hypot(p.value, q.value)
        : Math.abs(p.value);
    const activeLimit = numberValue(
      context.document.settings.slack_import_limit_mw,
    );
    const ratingLimit =
      rating === undefined
        ? undefined
        : rating * threshold(context.document, "P06", "rating_multiplier", 1);
    const above =
      (ratingLimit !== undefined && apparent > ratingLimit) ||
      (activeLimit !== undefined && p.value > activeLimit);
    const reverse =
      p.value <
        -threshold(context.document, "P06", "reverse_tolerance_mw", 1e-6) &&
      fieldValue(context.document.settings.allow_slack_export) !== true;
    const apparentExceeded =
      !reverse && ratingLimit !== undefined && apparent > ratingLimit;
    return above || reverse
      ? [
          finding(
            context,
            "P06",
            "warning",
            reverse
              ? "The slack source is absorbing active power although export is not expected."
              : "Slack output exceeds its declared infeed capability.",
            slackId ? [slackId] : [],
            "Review generation/load balance, power signs and infeed capability.",
            {
              value: apparentExceeded ? apparent : p.value,
              limit: reverse ? 0 : apparentExceeded ? ratingLimit : activeLimit,
              unit: apparentExceeded ? "MVA" : "MW",
            },
          ),
        ]
      : [];
  },
};

function loadingFindings(context: Context, warning: boolean): Finding[] {
  const run = currentSolution(context.document);
  if (run?.status !== "converged" || !run.results) return [];
  const alarm =
      numberValue(context.document.settings.branch_alarm_percent) ?? 100,
    lower = numberValue(context.document.settings.branch_warning_percent) ?? 80;
  return [...run.results.lines, ...run.results.transformers].flatMap(
    (branch) => {
      if (branch.loading_percent.status !== "available") return [];
      const value = branch.loading_percent.value;
      const exceeded = warning
        ? value > lower && value <= alarm
        : value > alarm;
      return exceeded
        ? [
            finding(
              context,
              warning ? "P04" : "P03",
              warning ? "warning" : "alarm",
              `${branch.element_id}: loading exceeds ${warning ? lower : alarm}%.`,
              [branch.element_id],
              "Review dispatch, network configuration and equipment capacity.",
              { value, limit: warning ? lower : alarm, unit: "%" },
            ),
          ]
        : [];
    },
  );
}
export function runRule(id: RuleId, document: StudyDocument): Finding[] {
  return rules[id]({ document, topology: analyzeTopology(document) });
}
export function validateNetwork(document: StudyDocument): Finding[] {
  const context = { document, topology: analyzeTopology(document) };
  const findings = RULE_IDS.flatMap((id) => rules[id](context));
  const run = currentSolution(document);
  if (run)
    findings.push(
      ...run.diagnostics.filter(
        (finding) =>
          finding.model_revision === document.revision &&
          !findings.some((existing) => existing.id === finding.id),
      ),
    );
  if (document.validation?.model_revision === document.revision)
    findings.push(
      ...document.validation.findings.filter(
        (finding) =>
          finding.stage === "solver_diagnostic" &&
          finding.model_revision === document.revision &&
          !findings.some((existing) => existing.id === finding.id),
      ),
    );
  return findings;
}
