"""Deterministic solved-case exports. Canonical JSON remains the lossless case.

MATPOWER and RAW are bus-branch snapshots: ideal closed switches are reduced,
constant-PQ injections are aggregated, and fixed taps keep their present ratio.
The pandapower T equivalent is converted to the electrically equivalent pi
network by pandapower's own converter. Nonstandard branch conductance is moved
to terminal bus shunts analytically, preserving the admittance matrix.
"""
from __future__ import annotations

import base64
import io
import re

import numpy as np
import pandapower as pp
from pandapower.converter.matpower.to_mpc import to_mpc
from scipy.io import savemat

from solver_adapter import ModelError, input_hash, to_pandapower, value


def _solve(document, context):
    s = document["settings"]
    pp.runpp(context["net"], algorithm="nr", calculate_voltage_angles=True, init="dc",
             max_iteration=int(value(s["max_iterations"], "max_iterations")),
             tolerance_mva=value(s["solver_tolerance_mva"], "solver_tolerance_mva"),
             enforce_q_lims=value(s["enforce_q_limits"], "enforce_q_limits"),
             trafo_model="t", trafo_loading="current", check_connectivity=True,
             voltage_depend_loads=False, distributed_slack=False, numba=False, lightsim2grid=False)


def _standard_mpc(net):
    internal = net["_ppc"]["internal"]
    solved_types = {int(row[0]): int(row[1]) for row in internal["bus"]}
    # runpp restores external PV labels after Q-limit iteration. The internal
    # final PQ/PV sets retain the actual solved control state.
    for label, code in (("pq", 1), ("pv", 2), ("ref", 3)):
        for index in internal[label]:
            solved_types[int(internal["bus"][index, 0])] = code
    case = to_mpc(net, calculate_voltage_angles=True, trafo_model="t", init="results")["mpc"]
    case = {k: v.copy() if isinstance(v, np.ndarray) else v for k, v in case.items()}
    case["gen"] = case["gen"][:, :21].copy()
    for row in case["bus"]:
        row[1] = solved_types[int(row[0])-1]
    for table in ("ext_grid", "gen"):
        indices = net["_pd2ppc_lookups"].get(table, [])
        for native_index, row in net[table].iterrows():
            if not row.in_service or native_index >= len(indices) or indices[native_index] < 0:
                continue
            export_index = indices[native_index]
            if export_index >= len(case["gen"]):
                continue
            case["gen"][export_index, 1:3] = net["res_" + table].loc[native_index, ["p_mw", "q_mvar"]]
    # MBASE only qualifies unused machine-impedance fields; system base is the
    # format convention when no machine rating exists, never a claimed rating.
    case["gen"][~np.isfinite(case["gen"][:, 6]), 6] = case["baseMVA"]
    for key in ("branch_r_asym", "branch_x_asym", "branch_g_asym", "branch_b_asym"):
        if key in case and np.any(case[key] != 0):
            raise ModelError(f"Cannot export asymmetric branch characteristic {key}")
        case.pop(key, None)
    bus, branch = case["bus"], case["branch"]
    by_id = {int(row[0]): i for i, row in enumerate(bus)}
    conductance = case.pop("branch_g", np.zeros(len(branch)))
    if len(conductance) != len(branch):
        raise ModelError("Cannot map branch shunt conductance after topology reduction")
    for row, g in zip(branch, conductance):
        if row[10]:
            tap = row[8] or 1.0
            bus[by_id[int(row[0])], 4] += case["baseMVA"] * float(g) / (2 * tap**2)
            bus[by_id[int(row[1])], 4] += case["baseMVA"] * float(g) / 2
    for key in ("bus", "branch", "gen"):
        if not np.isfinite(case[key]).all():
            raise ModelError(f"Non-finite {key} values cannot be exported")
    return case


def _raw_v33(case, frequency):
    """Write the supported RAW v33 subset; never infer machine dynamics data.

    ZR/ZX and ownership/control flags below are file placeholders not used in
    steady-state power flow. This is explicitly not a dynamics/short-circuit
    case. Transformer magnetizing admittance is represented as bus shunts.
    """
    bus, gen, branch = case["bus"].copy(), case["gen"], case["branch"].copy()
    by_id = {int(row[0]): i for i, row in enumerate(bus)}
    is_transformer = []
    for row in branch:
        a, b = by_id[int(row[0])], by_id[int(row[1])]
        trafo = row[8] != 0 or row[9] != 0 or not np.isclose(bus[a, 9], bus[b, 9])
        is_transformer.append(trafo)
        if trafo and row[10]:
            tap = row[8] or 1.0
            bus[a, 5] += case["baseMVA"] * row[4] / (2 * tap**2)
            bus[b, 5] += case["baseMVA"] * row[4] / 2
            row[4] = 0
    def record(*values):
        return ", ".join("'" + v.replace("'", "").replace("\n", " ") + "'" if isinstance(v, str)
                         else format(float(v), ".17g") for v in values)
    lines = [record(0, case["baseMVA"], 33, 0, 0, frequency),
             "SLD power flow: solved balanced study snapshot",
             "Fixed controls; canonical JSON preserves full source model"]
    for b in bus:
        lines.append(record(b[0], f"BUS{int(b[0])}", b[9], b[1], 1, 1, 1, b[7], b[8], b[11], b[12], b[11], b[12]))
    lines.append("0 / END OF BUS DATA, BEGIN LOAD DATA")
    for b in bus:
        if b[2] != 0 or b[3] != 0:
            lines.append(record(b[0], "1", 1, 1, 1, b[2], b[3], 0, 0, 0, 0, 1, 1, 0))
    lines.append("0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA")
    for b in bus:
        if b[4] != 0 or b[5] != 0:
            lines.append(record(b[0], "1", 1, b[4], b[5]))
    lines.append("0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA")
    gen_ids = {}
    for g in gen:
        count = gen_ids.get(int(g[0]), 0) + 1
        gen_ids[int(g[0])] = count
        if count > 99:
            raise ModelError("RAW v33 supports at most 99 exported generator identifiers per bus")
        lines.append(record(g[0], str(count), g[1], g[2], g[3], g[4], g[5], g[0],
                            g[6], 0, 1, 0, 0, 1, g[7], 100, g[8], g[9], 1, 1, 0, 0, 0, 0, 0, 0, 0, 1))
    lines.append("0 / END OF GENERATOR DATA, BEGIN NON-TRANSFORMER BRANCH DATA")
    ids = {}
    for idx, r in enumerate(branch):
        key = tuple(sorted((int(r[0]), int(r[1]))))
        ids[key] = ids.get(key, 0) + 1
        if ids[key] > 99:
            raise ModelError("RAW v33 supports at most 99 exported parallel circuit identifiers")
        if not is_transformer[idx]:
            lines.append(record(r[0], r[1], str(ids[key]), r[2], r[3], r[4], r[5], r[6], r[7],
                                0, 0, 0, 0, r[10], 1, 0, 1, 1))
    lines.append("0 / END OF NON-TRANSFORMER BRANCH DATA, BEGIN TRANSFORMER DATA")
    ids = {}
    for idx, r in enumerate(branch):
        key = tuple(sorted((int(r[0]), int(r[1]))))
        ids[key] = ids.get(key, 0) + 1
        if is_transformer[idx]:
            tap = r[8] or 1.0
            lines.append(record(r[0], r[1], 0, str(ids[key]), 1, 1, 1, 0, 0, 1, f"T{idx+1}", r[10], 1, 1, 0, 0, 0, 0, 0, 0))
            lines.append(record(r[2], r[3], case["baseMVA"]))
            lines.append(record(tap, 0, r[9], r[5], r[6], r[7], 0, 0, tap, tap, 1.1, 0.9, 2, 0, 0, 0, 0))
            lines.append(record(1, 0))
    lines.extend(["0 / END OF TRANSFORMER DATA, BEGIN AREA DATA", record(1, 0, 0, 10, "STUDY")])
    sections = ["AREA", "TWO-TERMINAL DC", "VSC DC", "IMPEDANCE CORRECTION", "MULTI-TERMINAL DC", "MULTI-SECTION LINE", "ZONE", "INTER-AREA TRANSFER", "OWNER", "FACTS", "SWITCHED SHUNT", "GNE", "INDUCTION MACHINE"]
    for n, section in enumerate(sections):
        following = sections[n+1] if n+1 < len(sections) else "END"
        lines.append(f"0 / END OF {section} DATA, BEGIN {following} DATA")
        if following == "ZONE":
            lines.append(record(1, "STUDY"))
        elif following == "OWNER":
            lines.append(record(1, "STUDY"))
    lines.append("Q")
    return "\n".join(lines) + "\n"


def export_document(document, format):
    """Return a JSON-compatible download; raises ModelError on unsupported data.

    bus_map.export_bus identifies the bus number in the actual export file.
    All files are solved from the supplied current input, never cached results.
    """
    formats = {"pandapower-json": ("json", "application/json", "utf-8"),
               "matpower": ("mat", "application/octet-stream", "base64"),
               "psse-raw": ("raw", "text/plain", "utf-8")}
    if format not in formats:
        raise ModelError(f"Unsupported export format: {format}")
    context = to_pandapower(document)
    _solve(document, context)
    net = context["net"]
    warnings = ["Native numerical snapshot uses reduced electrical buses. Keep canonical JSON for explicit switches, provenance, source drawing links and the editable case."]
    if format == "pandapower-json":
        data = pp.to_json(net)
        mapping = [{"native_bus": int(i), "export_bus": int(i)} for i in net.bus.index]
    else:
        case = _standard_mpc(net)
        warnings = ["Bus-branch snapshot: closed ideal switches are reduced; inactive and de-energized equipment is omitted. Keep canonical JSON for the complete editable model and provenance.",
                    "Constant-PQ loads and static generators are aggregated at each bus. Fixed transformer taps use their present ratio; automatic control and equipment nameplates are not reconstructed.",
                    "The pandapower T model is exported as its equivalent pi admittance. Branch conductance is represented as bus shunts. Null capability limits use pandapower's unbounded conversion convention. Where machine rating is missing, MBASE is the system base solely for unused machine impedance fields, not an equipment rating."]
        lookup = net["_pd2ppc_lookups"]["bus"]
        mapping = [{"native_bus": int(i), "export_bus": int(lookup[i])+1} for i in net.bus.index
                   if int(lookup[i]) < len(case["bus"]) and int(lookup[i]) >= 0]
        if format == "matpower":
            stream = io.BytesIO()
            savemat(stream, {"mpc": case}, do_compression=True)
            data = base64.b64encode(stream.getvalue()).decode("ascii")
        else:
            data = _raw_v33(case, net.f_hz)
            warnings.extend(["RAW v33 uses fixed transformer controls; magnetizing shunts are represented at the terminal buses. File-only ownership, area, zone and inactive control fields are placeholders, not engineering inputs.",
                             "Steady-state positive-sequence data only; machine impedance fields are non-operational placeholders. Not suitable for dynamics, short-circuit or unbalanced analysis.",
                             "This exporter was verified on bundled cases with the independent grg-pssedata v33 reader. Opening this file in Siemens PSS/E remains a user verification step."])
    extension, mime, encoding = formats[format]
    label = document.get("meta", {}).get("name", "study")
    if isinstance(label, dict):
        label = label.get("value", "study")
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", str(label)).strip("-.") or "study"
    return {"format": format, "filename": f"{name}.{extension}", "mime_type": mime,
            "encoding": encoding, "data": data, "warnings": warnings,
            "model_revision": document["revision"], "input_hash": input_hash(document), "bus_map": mapping}
