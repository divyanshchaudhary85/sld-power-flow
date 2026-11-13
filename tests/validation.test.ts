import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  CircuitBreaker,
  Element,
  SolutionRun,
  StudyDocument,
} from "../src/model";
import {
  analyzeTopology,
  RULE_IDS,
  runRule,
  validateNetwork,
} from "../src/validation";
import {
  listMissingData,
  applyStandardType,
  STANDARD_TYPES,
  suggestedDefaults,
  acceptSuggestion,
} from "../src/completion";
import {
  assumptionsRegister,
  removeElement,
  updateInput,
  userValue,
} from "../src/model/editing";

const fixture = (name = "case9"): StudyDocument =>
  JSON.parse(
    readFileSync(
      new URL(`../public/fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const missing = () => ({
  status: "missing" as const,
  reason: "not_shown" as const,
  candidates: [],
  evidence: [],
});
const values = (element: Element) =>
  element.data as unknown as Record<string, unknown>;
const at = "2026-11-13T00:00:00Z";
const source = {
  kind: "synthetic" as const,
  fixture_id: "rule-unit-test",
  generated_drawing: null,
};
const drawing = {
  file_id: "test-drawing",
  page: 1,
  bbox: { x_min: 0, y_min: 0, x_max: 1, y_max: 1 },
  text_span_ids: [],
};
function radial(): StudyDocument {
  const document = fixture();
  const buses = document.elements
    .filter((element) => element.type.value === "busbar")
    .slice(0, 2);
  const grid = document.elements.find(
    (element) => element.type.value === "external_grid",
  )!;
  const load = document.elements.find(
    (element) => element.type.value === "load",
  )!;
  const transformer = fixture("case14").elements.find(
    (element) => element.type.value === "transformer_2w",
  )!;
  const rewire = (
    element: Element,
    id: string,
    connections: Record<string, string>,
  ) => {
    element.id = id;
    element.source_ref = source;
    for (const [role, terminal] of Object.entries(element.terminals)) {
      terminal.id = `${id}:${role}`;
      terminal.connection_point = userValue(connections[role], at);
    }
  };
  rewire(buses[0], "BHV", { bus: "HV" });
  rewire(buses[1], "BLV", { bus: "LV" });
  rewire(grid, "G", { bus: "HV" });
  rewire(load, "LD", { bus: "LV" });
  rewire(transformer, "T", { hv: "HV", lv: "LV" });
  values(buses[0]).nominal_kv = userValue(110, at);
  values(buses[1]).nominal_kv = userValue(20, at);
  for (const bus of buses) {
    values(bus).voltage_min_pu = userValue(null, at);
    values(bus).voltage_max_pu = userValue(null, at);
  }
  for (const [key, value] of Object.entries({
    sn_mva: 100,
    vn_hv_kv: 110,
    vn_lv_kv: 20,
    vk_percent: 10,
    vkr_percent: 0.5,
    pfe_kw: 10,
    i0_percent: 0.1,
    phase_shift_degree: 0,
    parallel_count: 1,
    derating_factor: 1,
  }))
    values(transformer)[key] = userValue(value, at);
  values(transformer).tap = userValue({ kind: "none" }, at);
  values(load).p_mw = userValue(10, at);
  values(load).q_mvar = userValue(2, at);
  values(load).scaling_factor = userValue(1, at);
  values(grid).voltage_setpoint_kv = userValue(110, at);
  values(grid).infeed_rating_mva = userValue(500, at);
  document.elements = [...buses, grid, load, transformer];
  document.connectivity_points = ["HV", "LV"].map((id) => ({
    id,
    kind: "junction",
    position: { x: 0, y: 0 },
    source_ref: source,
    evidence: [],
  }));
  document.settings.slack_element_id = userValue("G", at);
  document.settings.slack_confirmed = userValue(true, at);
  document.solution = null;
  return document;
}
function addBreaker(document: StudyDocument, closed = true) {
  const transformer = document.elements.find((element) => element.id === "T")!;
  document.connectivity_points.push({
    id: "T-HV",
    kind: "junction",
    position: { x: 0, y: 0 },
    source_ref: source,
    evidence: [],
  });
  Object.values(transformer.terminals).find(
    (terminal) => terminal.role === "hv",
  )!.connection_point = userValue("T-HV", at);
  const base = structuredClone(document.elements[0]);
  const breaker = {
    ...base,
    id: "CB",
    type: userValue("circuit_breaker", at),
    data: {
      state: userValue(closed ? "closed" : "open", at),
      normal_state: userValue("closed", at),
      rated_current_ka: userValue(10, at),
      rated_voltage_kv: userValue(110, at),
      electrical_model: userValue("ideal", at),
    },
    terminals: Object.fromEntries(
      ["a", "b"].map((role, i) => [
        role,
        {
          id: `CB:${role}`,
          role,
          connection_point: userValue(i ? "T-HV" : "HV", at),
          source_ref: source,
          drawn_anchor: null,
        },
      ]),
    ),
  } as unknown as CircuitBreaker;
  document.elements.push(breaker);
  return breaker;
}
const n = (value: number) => ({ status: "available" as const, value });
function withResult(document: StudyDocument) {
  document.solution = {
    id: "synthetic-rule-test",
    model_revision: document.revision,
    input_hash: "unit-test-only",
    requested_at: at,
    completed_at: at,
    status: "converged",
    solver: {
      backend: "pandapower",
      backend_version: "test",
      runtime: "test",
      runtime_version: "test",
      package_lock_digest: "test",
      algorithm: "newton_raphson",
      tolerance_mva: 1e-8,
      max_iterations: 30,
      enforce_q_limits: false,
      transformer_equivalent: "t",
    },
    iterations: 3,
    timing: null,
    diagnostics: [],
    mappings: [],
    energized_point_ids: ["HV", "LV"],
    deenergized_point_ids: [],
    quality: {
      defaulted_input_paths: [],
      library_input_paths: [],
      user_input_paths: [],
      dependencies: [],
    },
    results: {
      buses: [
        {
          busbar_ids: ["BLV"],
          solver_bus_id: "LV",
          energized: true,
          voltage_pu: n(1),
          voltage_kv: n(20),
          angle_degree: n(0),
          net_p_mw: n(-10),
          net_q_mvar: n(-2),
        },
      ],
      lines: [],
      transformers: [
        {
          element_id: "T",
          energized: true,
          p_hv_mw: n(10),
          q_hv_mvar: n(2),
          p_lv_mw: n(-10),
          q_lv_mvar: n(-2),
          i_hv_ka: n(0.1),
          i_lv_ka: n(0.3),
          loading_percent: n(30),
          p_loss_mw: n(0),
          q_loss_mvar: n(0),
          tap_position: n(0),
        },
      ],
      generators: [
        {
          element_id: "G",
          energized: true,
          at_q_min: false,
          at_q_max: false,
          p_mw: n(10),
          q_mvar: n(2),
          voltage_kv: n(110),
        },
      ],
      external_grids: [],
      loads: [],
      shunts: [],
      system: {
        converged: true,
        iterations: 3,
        energized_bus_count: 2,
        total_generation_mw: n(10),
        total_generation_mvar: n(2),
        total_served_load_mw: n(10),
        total_served_load_mvar: n(2),
        total_unserved_load_mw: n(0),
        total_unserved_load_mvar: n(0),
        total_loss_mw: n(0),
        total_loss_mvar: n(0),
        slack_p_mw: n(10),
        slack_q_mvar: n(2),
      },
    },
  } satisfies SolutionRun;
  return document;
}

const mutations: Record<
  (typeof RULE_IDS)[number],
  (document: StudyDocument) => void
> = {
  D01: (d) => {
    d.elements[0].label = { ...missing(), reason: "unreadable" };
  },
  D02: (d) => {
    d.elements.push(structuredClone(d.elements[0]));
  },
  D03: (d) => {
    d.extraction.unresolved_endpoints.push({
      id: "end",
      observation_id: "observation",
      position: { x: 0, y: 0 },
      source_ref: drawing,
      attached_observation_id: missing(),
    });
  },
  D04: (d) => {
    d.extraction.unassociated_text.push({
      id: "text",
      text: userValue("unassigned label", at),
      source_ref: drawing,
      associated_element_id: userValue(null, at),
    });
  },
  D05: (d) => {
    d.review.status = "pending";
    d.elements[0].review.status = "unreviewed";
    d.elements[0].label = {
      status: "known",
      value: "uncertain",
      provenance: {
        source: "drawing",
        confidence: 0.1,
        evidence: [drawing],
        extraction_run_id: "test",
        reviewed: false,
      },
      derivation: null,
    };
  },
  T01: (d) => {
    d.elements = d.elements.filter(
      (element) => !["external_grid", "generator"].includes(element.type.value),
    );
  },
  T02: (d) => {
    addBreaker(d, false);
  },
  T03: (d) => {
    const transformer = d.elements.find((element) => element.id === "T")!;
    Object.values(transformer.terminals)[0].connection_point = missing();
  },
  T04: (d) => {
    const disconnected = structuredClone(d.elements[0]);
    disconnected.id = "EMPTY";
    Object.values(disconnected.terminals)[0].connection_point = userValue(
      "EMPTY",
      at,
    );
    d.elements.push(disconnected);
    d.connectivity_points.push({
      id: "EMPTY",
      kind: "junction",
      position: { x: 0, y: 0 },
      source_ref: source,
      evidence: [],
    });
  },
  E01: (d) => {
    const breaker = addBreaker(d);
    values(d.elements[0]).nominal_kv = userValue(220, at);
    values(breaker).rated_current_ka = userValue(10, at);
  },
  E02: (d) => {
    values(d.elements.find((element) => element.id === "T")!).vn_hv_kv =
      userValue(220, at);
  },
  E03: (d) => {
    values(d.elements.find((element) => element.id === "T")!).vk_percent =
      userValue(30, at);
  },
  E04: (d) => {
    values(d.elements[0]).nominal_kv = userValue(110000, at);
  },
  E05: (d) => {
    addBreaker(d).data.rated_current_ka = userValue(0.01, at);
  },
  E06: (d) => {
    values(d.elements.find((element) => element.id === "LD")!).p_mw = userValue(
      200,
      at,
    );
  },
  E07: (d) => {
    const generator = fixture().elements.find(
      (element) => element.type.value === "generator",
    )!;
    d.elements.push(generator);
    values(generator).sn_mva = userValue(1, at);
  },
  C01: (d) => {
    values(d.elements.find((element) => element.id === "T")!).vkr_percent =
      missing();
  },
  C02: (d) => {
    d.settings.slack_element_id = missing();
  },
  P01: (d) => {
    d.solution!.status = "nonconverged";
    d.solution!.results = null;
  },
  P02: (d) => {
    d.solution!.results!.buses[0].voltage_pu = n(0.9);
  },
  P03: (d) => {
    d.solution!.results!.transformers[0].loading_percent = n(101);
  },
  P04: (d) => {
    d.solution!.results!.transformers[0].loading_percent = n(90);
  },
  P05: (d) => {
    d.solution!.results!.generators[0].at_q_max = true;
  },
  P06: (d) => {
    d.solution!.results!.system.slack_p_mw = n(-10);
  },
};

describe("validation catalog", () => {
  it("implements every PDF catalog rule as a separately callable pure rule", () => {
    expect(RULE_IDS).toEqual([
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
    ]);
    const document = fixture();
    const before = JSON.stringify(document);
    expect(validateNetwork(document)).toEqual([]);
    expect(JSON.stringify(document)).toBe(before);
  });
  it("does not flag a clean transmission mesh as a topology error", () => {
    const document = fixture();
    expect(analyzeTopology(document).components).toHaveLength(1);
    expect(runRule("T02", document)).toEqual([]);
  });
  it("accepts the known 14-bus fixture without pre-solve errors", () => {
    expect(
      validateNetwork(fixture("case14")).filter(
        (finding) => finding.blocks_solve,
      ),
    ).toEqual([]);
  });
  it("honors explicit per-rule overrides and refuses to suppress an unknown slack mode", () => {
    const document = radial();
    mutations.E04(document);
    document.settings.additional_rule_thresholds.push({
      rule_id: "E04",
      parameter_name: "max_nominal_kv",
      value: userValue(200000, at),
      unit: "kV",
    });
    expect(runRule("E04", document)).toEqual([]);
    values(document.elements.find((element) => element.id === "G")!).mode =
      userValue("voltage_controlled", at);
    expect(
      runRule("C02", document).some((finding) => finding.blocks_solve),
    ).toBe(true);
  });
  it.each(RULE_IDS)(
    "%s is clean on the control fixture and identifies its deliberate failure",
    (id) => {
      const document = withResult(radial());
      expect(runRule(id, document)).toEqual([]);
      mutations[id](document);
      const findings = runRule(id, document);
      expect(findings.length).toBeGreaterThan(0);
      expect(new Set(findings.map((finding) => finding.rule_id))).toEqual(
        new Set([id]),
      );
      expect(
        findings.every((finding) => finding.message && finding.suggested_fix),
      ).toBe(true);
    },
  );
  it("retains an authorized outage finding without blocking the energized solve", () => {
    const document = radial();
    addBreaker(document, false);
    const topology = analyzeTopology(document);
    expect(topology.energizedElementIds).toContain("G");
    expect(topology.deenergizedElementIds).toContain("LD");
    document.operation.events.push({
      id: "open-CB",
      time: at,
      kind: "switch",
      selected_element_ids: ["CB"],
      changes: [],
      previous_revision: 0,
      new_revision: 0,
      solver_run_id: null,
      outcome: "confirmed",
      message: "Explicit test switching action",
    });
    document.operation.island_policy = {
      mode: "intentional_outage",
      authorized_isolated_element_ids: topology.deenergizedElementIds,
      authorizing_event_ids: ["open-CB"],
      energized_island_slacks: [],
    };
    expect(
      runRule("T02", document).every((finding) => !finding.blocks_solve),
    ).toBe(true);
  });
  it("does not attribute meshed loads to a single supplying transformer or show duplicate loading severity", () => {
    expect(runRule("E06", fixture("case14"))).toEqual([]);
    const document = withResult(radial());
    document.solution!.results!.transformers[0].loading_percent = n(101);
    expect(runRule("P03", document)).toHaveLength(1);
    expect(runRule("P04", document)).toEqual([]);
    document.solution!.status = "superseded";
    expect(runRule("P03", document)).toEqual([]);
  });
  it("separates required impedance from optional unknown generator nameplate ratings", () => {
    const document = fixture();
    expect(listMissingData(document)).toEqual([]);
    const line = document.elements.find(
      (element) => element.type.value === "line",
    )!;
    values(line).r_ohm_per_km = missing();
    expect(
      listMissingData(document).some((item) =>
        item.path.endsWith("/r_ohm_per_km"),
      ),
    ).toBe(true);
    expect(
      runRule("C01", document).every((finding) => finding.blocks_solve),
    ).toBe(true);
  });
});

describe("explicit completion and edit provenance", () => {
  it("replaces an input on a clone, labels the user source and invalidates the result/review", () => {
    const original = fixture();
    const next = updateInput(
      original,
      "/meta/base_mva",
      200,
      "2026-11-13T12:00:00Z",
    );
    expect(next.meta.base_mva).toMatchObject({
      status: "known",
      value: 200,
      provenance: { source: "user" },
    });
    expect(next.revision).toBe(original.revision + 1);
    expect(next.review.status).toBe("pending");
    expect(original.meta.base_mva).not.toMatchObject({ value: 200 });
  });
  it("lists all accepted non-drawing values, including user and library values", () => {
    const document = fixture();
    document.meta.base_mva = userValue(100);
    const rows = assumptionsRegister(document);
    expect(
      rows.some(
        (row) => row.path === "/meta/base_mva" && row.source === "user",
      ),
    ).toBe(true);
    expect(rows.some((row) => row.source === "library")).toBe(true);
    expect(
      rows.every(
        (row) =>
          !row.path.startsWith("/solution") &&
          !row.path.startsWith("/operation/base_snapshot"),
      ),
    ).toBe(true);
  });
  it("applies a library type only on an explicit call and retains its versioned provenance", () => {
    const document = fixture();
    const before = JSON.stringify(document);
    const line = document.elements.find(
      (element) => element.type.value === "line",
    )!;
    const type = STANDARD_TYPES.find((entry) =>
      entry.elementKinds.includes("line"),
    )!;
    expect(JSON.stringify(document)).toBe(before);
    const completed = applyStandardType(document, line.id, type.id);
    const changed = completed.elements.find(
      (element) => element.id === line.id,
    )!;
    expect(values(changed).r_ohm_per_km).toMatchObject({
      status: "known",
      provenance: { source: "library", item_id: type.id },
    });
    expect(JSON.stringify(document)).toBe(before);
  });
  it("keeps offered defaults out of assumptions until explicitly accepted", () => {
    const document = fixture();
    document.settings.max_iterations = missing();
    const suggestion = suggestedDefaults(document).find(
      (item) => item.target_path === "/settings/max_iterations",
    )!;
    expect(document.settings.max_iterations.status).toBe("missing");
    expect(
      assumptionsRegister(document).some(
        (row) => row.path === suggestion.target_path,
      ),
    ).toBe(false);
    const completed = acceptSuggestion(document, suggestion, at);
    expect(completed.settings.max_iterations).toMatchObject({
      value: 30,
      provenance: { source: "default" },
    });
    expect(
      completed.data_suggestions.find((item) => item.id === suggestion.id)
        ?.status,
    ).toBe("accepted");
    expect(() => acceptSuggestion(completed, suggestion, at)).toThrow(
      /already been completed/,
    );
  });
  it("requires reconversion when the frequency underlying library susceptance changes", () => {
    const document = fixture();
    const line = document.elements.find(
      (element) => element.type.value === "line",
    )!;
    const selected = applyStandardType(
      document,
      line.id,
      "149-AL1/24-ST1A 110.0",
      at,
    );
    const changed = updateInput(selected, "/meta/frequency_hz", 60, at);
    expect(
      values(changed.elements.find((element) => element.id === line.id)!)
        .b_us_per_km,
    ).toMatchObject({ status: "missing" });
    expect(
      listMissingData(changed).some((row) => row.attribute === "b_us_per_km"),
    ).toBe(true);
  });
  it("clears obsolete index-based offers and source selection when deleting the source", () => {
    const document = radial();
    document.data_suggestions.push({
      id: "offer",
      target_path: "/elements/4/data/pfe_kw",
      candidate_value: 0,
      source: "default",
      source_id: "test",
      source_version: "1",
      rationale: "unit-test offer",
      status: "offered",
    });
    const edited = removeElement(document, "G", at);
    expect(edited.settings.slack_element_id.status).toBe("missing");
    expect(edited.data_suggestions).toEqual([]);
    expect(document.elements.some((element) => element.id === "G")).toBe(true);
  });
});
