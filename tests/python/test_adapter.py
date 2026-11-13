"""Numerical contract tests: expected values always come from native pandapower."""
import copy
import json
from pathlib import Path
import sys

import numpy as np
import pandapower as pp
import pandapower.networks as networks
import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))
from solver_adapter import ModelError, from_pandapower, to_pandapower, solve_document, known


def fixture(name="case9"):
    native = getattr(networks, name)()
    template = json.loads((ROOT / "schema/fixture-template.json").read_text())
    return native, from_pandapower(native, name, template)


@pytest.mark.parametrize("name", ["case9", "case14"])
def test_native_roundtrip_and_result_schema(name):
    native, doc = fixture(name)
    pp.runpp(native, algorithm="nr", numba=False, lightsim2grid=False,
             calculate_voltage_angles=True, trafo_model="t", enforce_q_lims=False,
             tolerance_mva=1e-8, max_iteration=30)
    result = solve_document(doc, "test-input-hash")
    assert result["status"] == "converged"
    assert result["input_hash"] == "test-input-hash"
    bus_values = {b["busbar_ids"][0]: b["voltage_pu"]["value"] for b in result["results"]["buses"]}
    for index, row in native.res_bus.iterrows():
        assert abs(bus_values[f"bus-{index}"] - row.vm_pu) < 1e-6
    doc["solution"] = result
    schema = json.loads((ROOT / "schema/study-document.schema.json").read_text())
    Draft202012Validator(schema).validate(doc)
    assert np.isfinite(result["results"]["system"]["total_loss_mw"]["value"])


def test_missing_required_input_rejected_without_default():
    _, doc = fixture()
    line = next(e for e in doc["elements"] if e["type"]["value"] == "line")
    line["data"]["r_ohm_per_km"] = {"status": "missing", "reason": "not_shown", "candidates": [], "evidence": []}
    with pytest.raises(ModelError, match="r_ohm_per_km"):
        to_pandapower(doc)


def test_dangling_connection_rejected():
    _, doc = fixture()
    doc["elements"][0]["terminals"]["bus"]["connection_point"] = known("does-not-exist", "case9")
    with pytest.raises(ModelError, match="connection"):
        to_pandapower(doc)


def test_duplicate_ids_rejected():
    _, doc = fixture()
    doc["elements"].append(copy.deepcopy(doc["elements"][0]))
    with pytest.raises(ModelError, match="Duplicate"):
        to_pandapower(doc)


def test_case9_line_outage_recomputes_real_results():
    _, doc = fixture()
    baseline = solve_document(doc)
    line = next(e for e in doc["elements"] if e["id"] == "line-1")
    line["in_service"] = known(False, "case9")
    modified = solve_document(doc)
    assert modified["status"] == "converged"
    assert modified["results"]["system"]["total_loss_mw"]["value"] != baseline["results"]["system"]["total_loss_mw"]["value"]
    row = next(x for x in modified["results"]["lines"] if x["element_id"] == "line-1")
    assert not row["energized"]
    assert row["p_from_mw"]["status"] == "unavailable"


def test_explicit_switch_reduction_and_intentional_load_island():
    _, doc = fixture()
    load = next(e for e in doc["elements"] if e["type"]["value"] == "load")
    original_point = load["terminals"]["bus"]["connection_point"]["value"]
    point = copy.deepcopy(doc["connectivity_points"][0])
    point["id"] = "isolatable-load-terminal"
    doc["connectivity_points"].append(point)
    load["terminals"]["bus"]["connection_point"] = known(point["id"], "case9")
    switch = copy.deepcopy(load)
    switch.update(id="breaker-load", type=known("circuit_breaker", "case9"))
    switch["data"] = {"state": known("closed"), "normal_state": known("closed"),
        "rated_current_ka": known(1.0), "rated_voltage_kv": known(None), "electrical_model": known("ideal")}
    switch["terminals"] = {role: {"id": f"breaker-load:{role}", "role": role,
        "connection_point": known(pid), "source_ref": point["source_ref"], "drawn_anchor": None}
        for role, pid in (("a", original_point), ("b", point["id"]))}
    doc["elements"].append(switch)
    closed = solve_document(doc)
    assert closed["status"] == "converged"
    assert to_pandapower(doc)["point_to_bus"][original_point] == to_pandapower(doc)["point_to_bus"][point["id"]]
    switch["data"]["state"] = known("open")
    with pytest.raises(ModelError, match="Source-less island"):
        to_pandapower(doc)
    doc["operation"]["island_policy"].update(mode="intentional_outage", authorized_isolated_element_ids=[load["id"]], authorizing_event_ids=["switch-open"])
    doc["operation"]["events"].append({"id": "switch-open"})
    opened = solve_document(doc)
    assert opened["status"] == "converged"
    assert point["id"] in opened["deenergized_point_ids"]
    row = next(r for r in opened["results"]["loads"] if r["element_id"] == load["id"])
    assert row["p_mw"] == {"status": "unavailable", "reason": "deenergized"}
    assert opened["results"]["system"]["total_unserved_load_mw"]["value"] == load["data"]["p_mw"]["value"]


def test_nonconsecutive_source_bus_ids_preserve_identity():
    native = networks.case9()
    pp.toolbox.reindex_buses(native, {int(i): int(i) * 17 + 9 for i in native.bus.index})
    template = json.loads((ROOT / "schema/fixture-template.json").read_text())
    doc = from_pandapower(native, "nonconsecutive", template)
    result = solve_document(doc)
    pp.runpp(native, numba=False, lightsim2grid=False)
    solved = {eid: b["voltage_pu"]["value"] for b in result["results"]["buses"] for eid in b["busbar_ids"]}
    assert set(solved) == {f"bus-{idx}" for idx in native.bus.index}
    for idx, row in native.res_bus.iterrows():
        assert abs(solved[f"bus-{idx}"] - row.vm_pu) < 1e-6


def test_transformer_tap_change_and_q_limits_match_native():
    native, doc = fixture("case14")
    index = next(i for i, row in native.trafo.iterrows() if isinstance(row.tap_side, str))
    native.trafo.at[index, "tap_pos"] += 1
    transformer = next(e for e in doc["elements"] if e["id"] == f"trafo-{index}")
    transformer["data"]["tap"]["value"]["position"] = known(int(native.trafo.at[index, "tap_pos"]))
    doc["settings"]["enforce_q_limits"] = known(True)
    pp.runpp(native, numba=False, lightsim2grid=False, enforce_q_lims=True,
             calculate_voltage_angles=True, trafo_model="t", max_iteration=30, tolerance_mva=1e-8)
    run = solve_document(doc)
    assert run["status"] == "converged"
    solved = {eid: b["voltage_pu"]["value"] for b in run["results"]["buses"] for eid in b["busbar_ids"]}
    assert max(abs(solved[f"bus-{idx}"] - row.vm_pu) for idx, row in native.res_bus.iterrows()) < 1e-6


def test_nonconvergence_never_returns_previous_results():
    _, doc = fixture()
    doc["settings"]["max_iterations"] = known(1)
    doc["settings"]["solver_tolerance_mva"] = known(1e-14)
    result = solve_document(doc)
    assert result["status"] == "nonconverged"
    assert result["results"] is None
    assert result["diagnostics"][0]["rule_id"] == "SOLVE.NONCONVERGED"


@pytest.mark.parametrize("edit", ["unconfirmed", "stale"])
def test_review_confirmation_is_a_real_solve_gate(edit):
    _, doc = fixture()
    if edit == "unconfirmed":
        doc["review"]["status"] = "pending"
    else:
        doc["revision"] += 1
    with pytest.raises(ModelError, match="Review must be confirmed"):
        to_pandapower(doc)


def test_native_zip_is_not_silently_approximated():
    native = networks.case9()
    native.load.loc[native.load.index[0], "const_z_p_percent"] = 30
    template = json.loads((ROOT / "schema/fixture-template.json").read_text())
    with pytest.raises(ModelError, match="voltage-dependent"):
        from_pandapower(native, "invalid-zip", template)
