"""Independent-reader proof of the actual RAW files produced by WebAssembly."""
import json

import pandapower as pp

from test_adapter import ROOT
from test_exporters import read_independent_raw
from solver_adapter import utcnow


def main():
    target = ROOT / "test-results/runtime-exports"
    results = []
    for name in ("case9", "case14"):
        actual = read_independent_raw((target / f"{name}.raw").read_text())
        pp.runpp(actual, numba=False, trafo_model="pi", calculate_voltage_angles=True,
                 tolerance_mva=1e-8, max_iteration=30)
        mappings = json.loads((target / f"{name}-raw-bus-map.json").read_text())
        reference = json.loads((ROOT / f"public/fixtures/{name}-reference.json").read_text())
        by_id = {b["busbar_id"]: b["voltage_pu"] for b in reference["buses"]}
        error = max(abs(by_id[f"bus-{m['native_bus']}"] - actual.res_bus.at[m["export_bus"], "vm_pu"])
                    for m in mappings)
        assert error < 1e-4
        results.append({"fixture": name, "format": "psse-raw", "source": "actual Pyodide export",
                        "independent_reader": "grg-pssedata 0.1.4", "maximum_voltage_error_pu": float(error), "passed": True})
    proof = {"generated_at": utcnow(), "tolerance_pu": 1e-4, "tests": results, "psse_software_verified": False}
    (target / "raw-independent-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    print(json.dumps(results))


if __name__ == "__main__":
    main()
