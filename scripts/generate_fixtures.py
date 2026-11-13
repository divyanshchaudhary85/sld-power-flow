"""Generate reviewable canonical cases and independent native numerical references."""
from pathlib import Path
import json
import sys

import pandapower as pp
import pandapower.networks as networks
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from solver_adapter import from_pandapower, solve_document, utcnow

OPTIONS = dict(algorithm="nr", calculate_voltage_angles=True, init="dc", max_iteration=30,
               tolerance_mva=1e-8, trafo_model="t", trafo_loading="current", enforce_q_lims=False,
               check_connectivity=True, voltage_depend_loads=False, distributed_slack=False,
               numba=False, lightsim2grid=False)


def main():
    target = ROOT / "public/fixtures"
    target.mkdir(parents=True, exist_ok=True)
    template = json.loads((ROOT / "schema/fixture-template.json").read_text())
    schema = json.loads((ROOT / "schema/study-document.schema.json").read_text())
    validator = Draft202012Validator(schema)
    summary = []
    for name in ("case9", "case14"):
        native = getattr(networks, name)()
        canonical = from_pandapower(native, name, template)
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
        summary.append({"fixture": name, "maximum_voltage_error_pu": delta, "native_round_trip": "passed"})
    (target / "native-proof.json").write_text(json.dumps({"generated_at": utcnow(), "tests": summary}, indent=2) + "\n")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
