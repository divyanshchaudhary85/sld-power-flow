"""Regenerate the public measured export proof using only executed solvers."""
import base64
import json
import tempfile

import pandapower as pp
from pandapower.converter.matpower.from_mpc import from_mpc

from test_adapter import ROOT, fixture
from test_exporters import read_independent_raw
from exporters import export_document
from solver_adapter import to_pandapower, utcnow


def main():
    work = ROOT / "work"
    work.mkdir(exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(dir=work) as directory:
        from pathlib import Path
        for name in ("case9", "case14"):
            _, doc = fixture(name)
            reference = to_pandapower(doc)["net"]
            pp.runpp(reference, numba=False, trafo_model="t", calculate_voltage_angles=True, tolerance_mva=1e-8)
            for format in ("pandapower-json", "matpower", "psse-raw"):
                exported = export_document(doc, format)
                if format == "pandapower-json":
                    actual = pp.from_json_string(exported["data"])
                elif format == "matpower":
                    path = Path(directory) / "case.mat"
                    path.write_bytes(base64.b64decode(exported["data"]))
                    actual = from_mpc(str(path), f_hz=reference.f_hz)
                else:
                    actual = read_independent_raw(exported["data"])
                pp.runpp(actual, numba=False, calculate_voltage_angles=True, tolerance_mva=1e-8,
                         trafo_model="t" if format == "pandapower-json" else "pi")
                error = max(abs(reference.res_bus.at[m["native_bus"], "vm_pu"] -
                                actual.res_bus.at[m["export_bus"] - (format == "matpower"), "vm_pu"])
                            for m in exported["bus_map"])
                assert error < 1e-4
                results.append({"fixture": name, "format": format, "maximum_voltage_error_pu": error, "passed": True})
    proof = {"generated_at": utcnow(), "pandapower_version": pp.__version__, "tolerance_pu": 1e-4,
             "independent_raw_reader": "grg-pssedata 0.1.4 (BSD-3-Clause)",
             "raw_reader_caveats": "Test-only shims supply two omitted imports and a reporting ID. Known validator false positives for unused zero owner/control/table IDs are acknowledged. Parsing and electrical values are unchanged.",
             "psse_software_verified": False, "tests": results}
    (ROOT / "public/fixtures/export-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results))


if __name__ == "__main__":
    main()
