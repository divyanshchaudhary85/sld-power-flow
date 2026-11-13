"""Export files are checked by re-reading and solving, never canned voltages."""
import base64
import copy
import io
import json
from pathlib import Path
import sys
import warnings

import numpy as np
import pandapower as pp
from pandapower.converter.matpower.from_mpc import from_mpc
from pandapower.converter.pypower.from_ppc import from_ppc
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))
from exporters import export_document
from solver_adapter import ModelError, from_pandapower, known, to_pandapower
from test_adapter import fixture


def read_independent_raw(text):
    """LANL's BSD-3 RAW parser owns parsing and validates the written v33 file.

    The small bridge below maps its typed records to the standard MATPOWER
    arrays so that the independently parsed model can be re-solved.
    """
    from grg_pssedata.io import parse_psse_case_str
    import grg_pssedata.struct as raw_struct
    from grg_pssedata.exception import PSSEDataWarning
    # 0.1.4 omits its stdlib warnings import. Supply that namespace only; its
    # parser, validators and all interpreted electrical values stay unmodified.
    raw_struct.warnings = warnings
    raw_struct.PSSEDataWarning = PSSEDataWarning
    case = parse_psse_case_str(text)
    for transformer in case.transformers:
        # The validator references an unset reporting-only parent identifier.
        transformer.w1.transformer_id = transformer.index
        transformer.w2.transformer_id = transformer.index
    with warnings.catch_warnings(record=True) as issues:
        warnings.simplefilter("always")
        case.validate()
    # This old reader flags unused zero owner/control/table IDs even though RAW
    # permits zero for these disabled features. No electrical warning is hidden.
    allowed_zero_fields = ("owner", "bus identifier value 0 on transformer", "impedance correction table")
    assert all("value 0 " in str(w.message) and any(k in str(w.message) for k in allowed_zero_fields)
               for w in issues), [str(w.message) for w in issues]
    assert case.rev == 33
    buses = [[b.i, b.ide, 0, 0, 0, 0, b.area, b.vm, b.va, b.basekv,
              b.zone, b.nvhi, b.nvlo] for b in case.buses]
    bus = np.array(buses, dtype=float)
    by_id = {int(b[0]): n for n, b in enumerate(bus)}
    for load in case.loads:
        if load.status:
            bus[by_id[load.i], 2:4] += [load.pl, load.ql]
    for shunt in case.fixed_shunts:
        if shunt.status:
            bus[by_id[shunt.i], 4:6] += [shunt.gl, shunt.bl]
    gen = np.zeros((len(case.generators), 21))
    for row, g in zip(gen, case.generators):
        row[:10] = [g.i, g.pg, g.qg, g.qt, g.qb, g.vs, g.mbase, g.stat, g.pt, g.pb]
    branches = [[b.i, b.j, b.r, b.x, b.b, b.ratea, b.rateb, b.ratec, 0, 0,
                 b.st, -360, 360] for b in case.branches]
    for t in case.transformers:
        p, z, w, w2 = t.p1, t.p2, t.w1, t.w2
        assert p.cw == p.cz == p.cm == 1
        assert p.mag1 == p.mag2 == 0  # writer puts T-equivalent shunts on buses
        branches.append([p.i, p.j, z.r12, z.x12, 0, w.rata, w.ratb, w.ratc,
                         w.windv / w2.windv, w.ang, p.stat, -360, 360])
    return from_ppc({"version": "2", "baseMVA": case.sbase, "bus": bus,
                     "gen": gen, "branch": np.array(branches, dtype=float)}, f_hz=case.basfrq)


@pytest.mark.parametrize("name", ["case9", "case14"])
@pytest.mark.parametrize("fmt", ["pandapower-json", "matpower", "psse-raw"])
def test_export_roundtrip(name, fmt, tmp_path):
    _, doc = fixture(name)
    expected = to_pandapower(doc)["net"]
    pp.runpp(expected, numba=False, calculate_voltage_angles=True, trafo_model="t")
    before = copy.deepcopy(doc)
    out = export_document(doc, fmt)
    assert doc == before
    assert out["model_revision"] == doc["revision"]
    if fmt == "pandapower-json":
        actual = pp.from_json_string(out["data"])
        model = "t"
    elif fmt == "matpower":
        path = tmp_path / "export.mat"
        path.write_bytes(base64.b64decode(out["data"]))
        actual = from_mpc(str(path), f_hz=expected.f_hz)
        model = "pi"
    else:
        actual = read_independent_raw(out["data"])
        model = "pi"
    pp.runpp(actual, numba=False, calculate_voltage_angles=True, trafo_model=model,
             tolerance_mva=1e-8, max_iteration=30)
    for mapping in out["bus_map"]:
        bus = mapping["export_bus"] - (1 if fmt == "matpower" else 0)
        assert abs(expected.res_bus.at[mapping["native_bus"], "vm_pu"] -
                   actual.res_bus.at[bus, "vm_pu"]) < 1e-4


def test_invalid_format_and_missing_input_are_explicit():
    _, doc = fixture()
    with pytest.raises(ModelError, match="format"):
        export_document(doc, "invented")
    doc["review"]["status"] = "draft"
    with pytest.raises(ModelError, match="Review"):
        export_document(doc, "psse-raw")


@pytest.mark.parametrize("fmt", ["matpower", "psse-raw"])
def test_solved_reactive_limit_and_fixed_generation_are_preserved(fmt, tmp_path):
    native, _ = fixture("case14")
    native.gen.loc[:, "max_q_mvar"] = 0
    native.gen.loc[:, "min_q_mvar"] = -1
    pp.create_sgen(native, 8, p_mw=2, q_mvar=.1, sn_mva=3)
    doc = from_pandapower(native, "q-limited", json.loads((ROOT / "schema/fixture-template.json").read_text()))
    doc["settings"]["enforce_q_limits"] = known(True)
    expected = to_pandapower(doc)["net"]
    pp.runpp(expected, numba=False, enforce_q_lims=True, trafo_model="t", calculate_voltage_angles=True)
    out = export_document(doc, fmt)
    if fmt == "matpower":
        path = tmp_path / "limited.mat"
        path.write_bytes(base64.b64decode(out["data"]))
        actual = from_mpc(str(path), f_hz=expected.f_hz)
    else:
        actual = read_independent_raw(out["data"])
    pp.runpp(actual, numba=False, trafo_model="pi", calculate_voltage_angles=True)
    for m in out["bus_map"]:
        bus = m["export_bus"] - (1 if fmt == "matpower" else 0)
        assert abs(expected.res_bus.at[m["native_bus"], "vm_pu"] - actual.res_bus.at[bus, "vm_pu"]) < 1e-4


@pytest.mark.parametrize("fmt", ["matpower", "psse-raw"])
def test_nonzero_magnetizing_loss_and_line_conductance_preserved(fmt, tmp_path):
    native, _ = fixture("case14")
    native.trafo.loc[:, "pfe_kw"] = 0.5
    native.trafo.loc[:, "i0_percent"] = 0.1
    native.line.loc[:, "g_us_per_km"] = 0.2
    doc = from_pandapower(native, "magnetization", json.loads((ROOT / "schema/fixture-template.json").read_text()))
    expected = to_pandapower(doc)["net"]
    pp.runpp(expected, numba=False, trafo_model="t", calculate_voltage_angles=True)
    out = export_document(doc, fmt)
    if fmt == "matpower":
        path = tmp_path / "magnetization.mat"
        path.write_bytes(base64.b64decode(out["data"]))
        actual = from_mpc(str(path), f_hz=expected.f_hz)
    else:
        actual = read_independent_raw(out["data"])
    pp.runpp(actual, numba=False, trafo_model="pi", calculate_voltage_angles=True)
    for m in out["bus_map"]:
        bus = m["export_bus"] - (1 if fmt == "matpower" else 0)
        assert abs(expected.res_bus.at[m["native_bus"], "vm_pu"] - actual.res_bus.at[bus, "vm_pu"]) < 1e-4
