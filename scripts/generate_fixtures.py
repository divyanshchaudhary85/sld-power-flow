"""Generate reviewable canonical cases and independent native numerical references."""
from pathlib import Path
import copy
import json
import sys
import time

import pandapower as pp
import pandapower.networks as networks
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from solver_adapter import from_pandapower, solve_document, utcnow, known, missing, input_hash

OPTIONS = dict(algorithm="nr", calculate_voltage_angles=True, init="dc", max_iteration=30,
               tolerance_mva=1e-8, trafo_model="t", trafo_loading="current", enforce_q_lims=False,
               check_connectivity=True, voltage_depend_loads=False, distributed_slack=False,
               numba=False, lightsim2grid=False)


def synthetic50():
    """Explicit synthetic study inputs, not a standardized IEEE test system."""
    net = pp.create_empty_network(sn_mva=100, f_hz=50)
    for i in range(50):
        pp.create_bus(net, vn_kv=110, name=f"Synthetic bus {i+1}", min_vm_pu=.95, max_vm_pu=1.05)
    pp.create_ext_grid(net, 0, vm_pu=1, name="Synthetic source")
    for i in range(1, 50):
        pp.create_line_from_parameters(net, i-1, i, length_km=1, r_ohm_per_km=.1,
                                      x_ohm_per_km=.2, c_nf_per_km=0, max_i_ka=1,
                                      name=f"Synthetic circuit {i}")
        pp.create_load(net, i, p_mw=1, q_mvar=.2, name=f"Synthetic load {i}")
    return net


def add_load_breaker(doc):
    """A separate terminal point prevents a direct bypass of the load breaker."""
    load = next(e for e in doc["elements"] if e["type"]["value"] == "load")
    original = load["terminals"]["bus"]["connection_point"]["value"]
    point = copy.deepcopy(next(p for p in doc["connectivity_points"] if p["id"] == original))
    point.update(id="point-isolatable-load", kind="terminal_point")
    point["position"]["x"] += 120
    doc["connectivity_points"].append(point)
    load["terminals"]["bus"]["connection_point"] = known(point["id"], "case9-breaker")
    load["layout"]["position"] = copy.deepcopy(point["position"])
    breaker = copy.deepcopy(load)
    breaker.update(id="breaker-load", type=known("circuit_breaker", "case9-breaker"),
                   label=known("Load isolation breaker", "case9-breaker"))
    breaker["layout"]["position"]["x"] -= 60
    breaker["terminals"] = {role: {"id": f"breaker-load:{role}", "role": role,
        "connection_point": known(pid, "case9-breaker"), "source_ref": copy.deepcopy(point["source_ref"]), "drawn_anchor": None}
        for role, pid in (("a", original), ("b", point["id"]))}
    breaker["data"] = {"state": known("closed", "case9-breaker"), "normal_state": known("closed", "case9-breaker"),
        "rated_current_ka": missing(), "rated_voltage_kv": known(None, "case9-breaker"),
        "electrical_model": known("ideal", "case9-breaker")}
    doc["elements"].append(breaker)


def main():
    target = ROOT / "public/fixtures"
    target.mkdir(parents=True, exist_ok=True)
    template = json.loads((ROOT / "schema/fixture-template.json").read_text())
    schema = json.loads((ROOT / "schema/study-document.schema.json").read_text())
    validator = Draft202012Validator(schema)
    summary = []
    for name in ("case9", "case14", "case9-breaker", "case50"):
        native = synthetic50() if name == "case50" else getattr(networks, name.split("-")[0])()
        canonical = from_pandapower(native, name, template)
        if name == "case9-breaker":
            add_load_breaker(canonical)
            canonical["meta"]["name"] = known("IEEE 9-bus with load isolation breaker", name)
        if name == "case50":
            canonical["meta"]["name"] = known("Synthetic 50-bus performance feeder", name)
        if name in ("case9-breaker", "case50"):
            def relabel(obj):
                if isinstance(obj, dict):
                    if obj.get("source") == "library":
                        obj.update(library_id="sld-power-flow.synthetic-fixtures", library_version="1")
                    for child in obj.values():
                        relabel(child)
                elif isinstance(obj, list):
                    for child in obj:
                        relabel(child)
            relabel(canonical)
            canonical["review"]["confirmed_input_hash"] = input_hash(canonical)
        validator.validate(canonical)
        pp.runpp(native, **OPTIONS)
        solved = solve_document(canonical)
        if solved["status"] != "converged":
            raise RuntimeError(solved["diagnostics"])
        by_id = {eid: row["voltage_pu"]["value"] for row in solved["results"]["buses"] for eid in row["busbar_ids"]}
        delta = max(abs(by_id[f"bus-{index}"] - row.vm_pu) for index, row in native.res_bus.iterrows())
        if delta >= 1e-6:
            raise AssertionError(f"{name} round-trip voltage error {delta}")
        reference = {"fixture_id": name, "pandapower_version": pp.__version__, "options": OPTIONS,
            "generated_at": utcnow(), "buses": [{"busbar_id": f"bus-{index}", "voltage_pu": float(row.vm_pu),
                "voltage_kv": float(row.vm_pu * native.bus.at[index, "vn_kv"]), "angle_degree": float(row.va_degree),
                "net_p_mw": float(-row.p_mw), "net_q_mvar": float(-row.q_mvar)} for index, row in native.res_bus.iterrows()],
            "system": {"total_generation_mw": float(sum(native["res_"+t].p_mw.sum() for t in ("gen", "sgen", "ext_grid"))),
                "total_served_load_mw": float(native.res_load.p_mw.sum() + native.res_shunt.p_mw.sum()),
                "total_loss_mw": float(native.res_line.pl_mw.sum() + native.res_trafo.pl_mw.sum())}}
        # No pre-populated solution: the UI must obtain its displayed study from
        # an actual browser Worker solve. References are labelled proof data.
        canonical["solution"] = None
        (target / f"{name}.json").write_text(json.dumps(canonical, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        (target / f"{name}-reference.json").write_text(json.dumps(reference, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        warm_ms = []
        if name == "case50":
            for _ in range(5):
                started = time.perf_counter()
                trial = solve_document(canonical)
                warm_ms.append((time.perf_counter()-started)*1000)
                if trial["status"] != "converged":
                    raise AssertionError(trial["diagnostics"])
        summary.append({"fixture": name, "maximum_voltage_error_pu": delta, "native_round_trip": "passed",
                        "native_warm_solve_ms": warm_ms or None})
    (target / "native-proof.json").write_text(json.dumps({"generated_at": utcnow(), "tests": summary}, indent=2) + "\n")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
