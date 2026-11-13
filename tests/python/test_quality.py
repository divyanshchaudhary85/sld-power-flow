"""Default markers follow electrical dependencies, including multiple islands."""
import copy
import json

import pandapower as pp

from test_adapter import ROOT, fixture
from solver_adapter import from_pandapower, known, solve_document


def two_islands():
    net = pp.create_empty_network(sn_mva=100, f_hz=50)
    for first in (0, 2):
        for _ in range(2):
            pp.create_bus(net, vn_kv=110)
        pp.create_ext_grid(net, first, vm_pu=1)
        pp.create_line_from_parameters(net, first, first+1, length_km=1,
                                      r_ohm_per_km=.1, x_ohm_per_km=.2,
                                      c_nf_per_km=0, max_i_ka=1)
        pp.create_load(net, first+1, p_mw=1, q_mvar=.2)
    template = json.loads((ROOT / "schema/fixture-template.json").read_text())
    doc = from_pandapower(net, "two-islands", template)
    doc["operation"]["island_policy"]["energized_island_slacks"] = [
        {"connectivity_point_ids": ["point-0", "point-1"], "slack_element_id": "grid-0"}]
    return doc


def test_default_load_propagates_within_its_island_and_to_system_only():
    doc = two_islands()
    index = next(i for i, e in enumerate(doc["elements"]) if e["id"] == "load-0")
    path = f"/elements/{index}/data/p_mw"
    doc["elements"][index]["data"]["p_mw"] = known(1, source="default", rationale="Quality dependency test")
    run = solve_document(doc)
    assert run["status"] == "converged"
    assert path in run["quality"]["defaulted_input_paths"]
    dependencies = {d["result_path"]: d for d in run["quality"]["dependencies"]}
    assert "/results" not in dependencies
    for i, bus in enumerate(run["results"]["buses"]):
        depends = dependencies[f"/results/buses/{i}"]
        first_island = any(eid in ("bus-0", "bus-1") for eid in bus["busbar_ids"])
        assert (path in depends["input_paths"]) == first_island
        assert depends["method"] == "conservative_connected_component"
    for table in ("lines", "external_grids", "loads"):
        for i, row in enumerate(run["results"][table]):
            assert (path in dependencies[f"/results/{table}/{i}"]["input_paths"]) == row["element_id"].endswith("-0")
    assert path in dependencies["/results/system"]["input_paths"]


def test_global_electrical_inputs_propagate_but_default_display_metadata_does_not():
    doc = two_islands()
    doc["meta"]["base_mva"] = known(100, source="default", rationale="Explicit study base")
    doc["meta"]["name"] = known("Display label", source="default", rationale="Display only")
    run = solve_document(doc)
    assert run["status"] == "converged"
    assert "/meta/name" in run["quality"]["defaulted_input_paths"]
    for d in run["quality"]["dependencies"]:
        assert "/meta/base_mva" in d["input_paths"]
        assert "/meta/name" not in d["input_paths"]


def test_no_dependency_claims_for_a_failed_result():
    doc = two_islands()
    doc["review"]["status"] = "pending"
    run = solve_document(doc)
    assert run["results"] is None
    assert run["quality"]["dependencies"] == []


def test_connected_case_uses_equivalent_table_prefixes_to_bound_payload_size():
    _, doc = fixture()
    run = solve_document(doc)
    dependencies = run["quality"]["dependencies"]
    assert any(d["result_path"] == "/results/buses" for d in dependencies)
    assert any(d["result_path"] == "/results/lines" for d in dependencies)
    assert len(dependencies) < 10
    for table, rows in run["results"].items():
        if table == "system":
            continue
        for index in range(len(rows)):
            path = f"/results/{table}/{index}/p_mw"
            assert any(path.startswith(d["result_path"] + "/") for d in dependencies)


def test_only_inherited_voltage_base_crosses_an_open_switch_dependency():
    doc = two_islands()
    doc["elements"] = [e for e in doc["elements"] if e["id"] not in ("bus-2", "bus-3")]
    bus_index = next(i for i, e in enumerate(doc["elements"]) if e["id"] == "bus-1")
    doc["elements"][bus_index]["data"]["nominal_kv"] = known(110, source="default")
    load_index = next(i for i, e in enumerate(doc["elements"]) if e["id"] == "load-0")
    doc["elements"][load_index]["data"]["p_mw"] = known(1, source="default")
    line = next(e for e in doc["elements"] if e["id"] == "line-1")
    line["data"]["from_nominal_kv"] = known(None)
    line["data"]["to_nominal_kv"] = known(None)
    switch = copy.deepcopy(doc["elements"][load_index])
    switch.update(id="open-tie", type=known("circuit_breaker"))
    switch["data"] = {"state": known("open"), "normal_state": known("open"),
                      "electrical_model": known("ideal"), "rated_current_ka": known(1), "rated_voltage_kv": known(None)}
    switch["terminals"] = {role: {"id": f"open-tie:{role}", "role": role,
        "connection_point": known(point), "source_ref": switch["source_ref"], "drawn_anchor": None}
        for role, point in (("a", "point-1"), ("b", "point-2"))}
    doc["elements"].append(switch)
    run = solve_document(doc)
    assert run["status"] == "converged"
    index = next(i for i, row in enumerate(run["results"]["loads"]) if row["element_id"] == "load-1")
    dep = next(d for d in run["quality"]["dependencies"] if d["result_path"] == f"/results/loads/{index}")
    assert f"/elements/{bus_index}/data/nominal_kv" in dep["input_paths"]
    assert f"/elements/{load_index}/data/p_mw" not in dep["input_paths"]
