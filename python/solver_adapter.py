"""Canonical node-breaker model ↔ pandapower, with no inferred electrical inputs.

This module runs unchanged in CPython and the Pyodide worker. Per-unit conversions
are confined here. Canonical inputs are never mutated by a solve.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import json
import math
import platform
import time
import uuid

import numpy as np
import pandapower as pp


class ModelError(ValueError):
    """The draft cannot safely be converted into a solved electrical case."""


def utcnow():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def known(value, fixture_id="reference", *, source="library", rationale=None):
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return missing()
    provenance = {"source": "library", "library_id": "pandapower.networks",
                  "library_version": pp.__version__, "item_id": fixture_id,
                  "accepted_at": "2026-11-13T00:00:00Z"}
    if source == "default":
        provenance = {"source": "default", "default_id": "reference-study-options",
                      "default_version": "1", "accepted_at": "2026-11-13T00:00:00Z",
                      "rationale": rationale or "Explicit study option for bundled reference proof."}
    return {"status": "known", "value": value, "provenance": provenance, "derivation": None}


def missing():
    return {"status": "missing", "reason": "not_shown", "candidates": [], "evidence": []}


def value(field, path, *, nullable=False):
    if not isinstance(field, dict) or field.get("status") != "known":
        raise ModelError(f"Missing required input: {path}")
    result = field.get("value")
    if result is None and not nullable:
        raise ModelError(f"Missing required input: {path}")
    if isinstance(result, (float, int)) and not isinstance(result, bool) and not math.isfinite(result):
        raise ModelError(f"Non-finite input: {path}")
    return result


def optional(field):
    if isinstance(field, dict) and field.get("status") == "known":
        return field.get("value")
    return None


def input_hash(document):
    """Native provenance hash. Browser supplies its own canonical hash explicitly."""
    keys = ("meta", "settings", "connectivity_points", "elements")
    payload = {key: document[key] for key in keys}
    payload["island_policy"] = document["operation"]["island_policy"]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


class UnionFind:
    def __init__(self, ids):
        self.parent = {key: key for key in ids}

    def find(self, key):
        if self.parent[key] != key:
            self.parent[key] = self.find(self.parent[key])
        return self.parent[key]

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.parent[b] = a


def to_pandapower(document):
    """Return an adapter context; malformed or incomplete drafts raise ModelError."""
    if document.get("schema_version") != "1.0.0":
        raise ModelError("Unsupported canonical schema version")
    review = document.get("review", {})
    if review.get("status") != "confirmed" or review.get("confirmed_model_revision") != document["revision"]:
        raise ModelError("Review must be confirmed for the current model revision before solving")
    meta, settings = document["meta"], document["settings"]
    base = value(meta["base_mva"], "meta.base_mva")
    frequency = value(meta["frequency_hz"], "meta.frequency_hz")
    if base <= 0 or frequency not in (50, 60):
        raise ModelError("System base must be positive and frequency must be 50 or 60 Hz")
    if not value(settings["base_confirmed"], "settings.base_confirmed") or not value(settings["slack_confirmed"], "settings.slack_confirmed"):
        raise ModelError("Confirm the system base and slack source before solving")
    slack_id = value(settings["slack_element_id"], "settings.slack_element_id")
    conventions = settings["conventions"]
    if conventions.get("transformer_equivalent") != "t" or conventions.get("algorithm") != "newton_raphson" or conventions.get("distributed_slack") is not False:
        raise ModelError("Unsupported solver conventions")
    points = document["connectivity_points"]
    elements = document["elements"]
    point_ids = [p["id"] for p in points]
    ids = [e["id"] for e in elements]
    if len(set(point_ids)) != len(point_ids) or len(set(ids)) != len(ids):
        raise ModelError("Duplicate element or connectivity point IDs")
    by_id = {e["id"]: e for e in elements}
    if slack_id not in by_id:
        raise ModelError("Selected slack source does not exist")
    if sum(value(e["type"], e["id"] + ".type") == "busbar" for e in elements) > 50:
        raise ModelError("Version 1 supports at most 50 busbars")
    if not point_ids:
        raise ModelError("Network is empty")
    kinds, active, terminals = {}, {}, {}
    role_catalog = {"busbar": {"bus"}, "line": {"from", "to"}, "cable": {"from", "to"},
                    "transformer_2w": {"hv", "lv"}, "external_grid": {"bus"}, "generator": {"bus"},
                    "static_generator": {"bus"}, "load": {"bus"}, "motor": {"bus"}, "shunt": {"bus"},
                    "circuit_breaker": {"a", "b"}, "disconnector": {"a", "b"}, "fuse": {"a", "b"}}
    terminal_ids = set()
    for e in elements:
        eid = e["id"]
        kinds[eid] = value(e["type"], eid + ".type")
        active[eid] = value(e["in_service"], eid + ".in_service")
        kind = kinds[eid]
        if kind not in role_catalog:
            raise ModelError(f"Unsupported element type: {kind} ({eid})")
        if kind == "busbar" and not active[eid]:
            raise ModelError("A busbar service outage must be represented by explicit switching in Phase 1")
        if set(e["terminals"]) != role_catalog[kind]:
            raise ModelError(f"Incorrect terminals on {eid}")
        terminals[eid] = {}
        for role, t in e["terminals"].items():
            if t["id"] in terminal_ids:
                raise ModelError("Duplicate terminal ID")
            terminal_ids.add(t["id"])
            point = value(t["connection_point"], f"{eid}.terminals.{role}.connection_point")
            if point not in point_ids:
                raise ModelError(f"Unknown connection point {point} on {eid}")
            terminals[eid][role] = point
    uf = UnionFind(point_ids)
    switches = {"circuit_breaker", "disconnector", "fuse"}
    for e in elements:
        eid = e["id"]
        if kinds[eid] in switches:
            if value(e["data"]["electrical_model"], eid + ".electrical_model") != "ideal":
                raise ModelError("Only ideal switching devices are supported")
            state = value(e["data"]["state"], eid + ".state")
            if active[eid] and state == "closed":
                uf.union(terminals[eid]["a"], terminals[eid]["b"])
    groups = {}
    for point in point_ids:
        groups.setdefault(uf.find(point), []).append(point)
    roots = list(groups)
    if len(roots) > 50:
        raise ModelError("Version 1 supports at most 50 reduced electrical buses")
    nominal = {}

    def set_voltage(point, kv, origin):
        if kv is None:
            return
        if not isinstance(kv, (int, float)) or not math.isfinite(kv) or kv <= 0:
            raise ModelError(f"Invalid nominal voltage on {origin}")
        root = uf.find(point)
        if root in nominal and not math.isclose(nominal[root], kv, rel_tol=1e-8, abs_tol=1e-9):
            raise ModelError(f"Conflicting nominal kV on closed electrical node ({origin})")
        nominal[root] = float(kv)

    equal_voltage_links = []
    for e in elements:
        eid, d, t = e["id"], e["data"], terminals[e["id"]]
        kind = kinds[eid]
        if kind == "busbar":
            set_voltage(t["bus"], value(d["nominal_kv"], eid + ".nominal_kv"), eid)
        elif kind in ("line", "cable"):
            set_voltage(t["from"], optional(d["from_nominal_kv"]), eid)
            set_voltage(t["to"], optional(d["to_nominal_kv"]), eid)
            equal_voltage_links.append((t["from"], t["to"], True))
        elif kind == "transformer_2w":
            set_voltage(t["hv"], value(d["vn_hv_kv"], eid + ".vn_hv_kv"), eid)
            set_voltage(t["lv"], value(d["vn_lv_kv"], eid + ".vn_lv_kv"), eid)
        elif kind == "shunt":
            set_voltage(t["bus"], value(d["nominal_kv"], eid + ".nominal_kv"), eid)
        elif kind in switches:
            equal_voltage_links.append((t["a"], t["b"], False))
    for _ in range(len(roots)):
        changed = False
        for a, b, require_equal in equal_voltage_links:
            a, b = uf.find(a), uf.find(b)
            if a in nominal and b not in nominal:
                nominal[b] = nominal[a]
                changed = True
            elif b in nominal and a not in nominal:
                nominal[a] = nominal[b]
                changed = True
            elif require_equal and a in nominal and b in nominal and not math.isclose(nominal[a], nominal[b], rel_tol=1e-8):
                raise ModelError("Line connects unequal nominal voltages")
        if not changed:
            break
    unknown = [p for p in roots if p not in nominal]
    if unknown:
        raise ModelError("Missing nominal voltage for electrical node: " + unknown[0])
    # Determine islands before asking the numerical library to solve; do not allow
    # its connectivity filter to silently discard an accidental orphan.
    graph = {r: set() for r in roots}
    for e in elements:
        eid, kind = e["id"], kinds[e["id"]]
        if active[eid] and kind in ("line", "cable", "transformer_2w"):
            ends = list(terminals[eid].values())
            a, b = map(uf.find, ends)
            graph[a].add(b)
            graph[b].add(a)
    components, unseen = [], set(roots)
    while unseen:
        stack, component = [next(iter(unseen))], set()
        while stack:
            r = stack.pop()
            if r in component:
                continue
            component.add(r)
            stack.extend(graph[r] - component)
        unseen -= component
        components.append(component)
    policy = document["operation"]["island_policy"]
    slack_ids = {slack_id}
    slack_ids.update(x["slack_element_id"] for x in policy["energized_island_slacks"])
    for sid in slack_ids:
        if sid not in by_id or kinds[sid] not in ("external_grid", "generator") or not active[sid]:
            raise ModelError("Slack must be an in-service external grid or synchronous generator")
    energized_roots, excluded_ids = set(), set()
    for component in components:
        sources = [sid for sid in slack_ids if uf.find(terminals[sid]["bus"]) in component]
        if len(sources) > 1:
            raise ModelError("An energized island must have exactly one confirmed slack")
        if sources:
            energized_roots |= component
        else:
            equipment = {e["id"] for e in elements if active[e["id"]] and kinds[e["id"]] not in switches
                         and any(uf.find(p) in component for p in terminals[e["id"]].values())}
            if equipment:
                authorized = set(policy["authorized_isolated_element_ids"])
                event_ids = {event["id"] for event in document["operation"]["events"]}
                event_authorized = bool(policy["authorizing_event_ids"]) and set(policy["authorizing_event_ids"]) <= event_ids
                if policy["mode"] != "intentional_outage" or not event_authorized or not equipment <= authorized:
                    raise ModelError("Source-less island requires explicit intentional-outage authorization: " + ", ".join(sorted(equipment)))
                excluded_ids |= equipment
    net = pp.create_empty_network(name=value(meta["name"], "meta.name"), f_hz=frequency, sn_mva=base)
    root_to_bus, busbars, mapping = {}, {}, []
    for root in roots:
        bars = [eid for eid in ids if kinds[eid] == "busbar" and uf.find(terminals[eid]["bus"]) == root]
        busbars[root] = bars
        bus = pp.create_bus(net, vn_kv=nominal[root], name=" / ".join(bars) or root,
                            in_service=root in energized_roots)
        root_to_bus[root] = bus
        mapping.append({"solver_id": f"bus:{bus}", "solver_kind": "bus", "canonical_element_ids": bars,
                        "canonical_point_ids": groups[root], "terminal_ids": [t["id"] for e in elements for t in e["terminals"].values()
                        if value(t["connection_point"], "connection") in groups[root]]})
    element_to_native = {}
    for e in elements:
        eid, d, kind = e["id"], e["data"], kinds[e["id"]]
        get = lambda key: value(d[key], f"{eid}.data.{key}")
        op = lambda key: optional(d.get(key))
        buses = {role: root_to_bus[uf.find(point)] for role, point in terminals[eid].items()}
        live = active[eid] and eid not in excluded_ids
        common = {"name": optional(e["label"]) or eid, "in_service": live}
        if kind in switches or kind == "busbar":
            continue
        if kind in ("line", "cable"):
            length, r, x = get("length_km"), get("r_ohm_per_km"), get("x_ohm_per_km")
            if length <= 0 or r < 0 or x < 0 or r + x <= 0:
                raise ModelError(f"Invalid line length or impedance: {eid}")
            current, parallel, derating = get("max_current_ka"), get("parallel_count"), get("derating_factor")
            if current <= 0 or parallel < 1 or int(parallel) != parallel or not 0 < derating <= 1:
                raise ModelError(f"Invalid line rating, parallel count or derating: {eid}")
            b = get("b_us_per_km")
            idx = pp.create_line_from_parameters(net, buses["from"], buses["to"], length, r, x,
                c_nf_per_km=b * 1000 / (2 * math.pi * frequency), g_us_per_km=get("g_us_per_km"),
                max_i_ka=current, parallel=int(parallel), df=derating, type="cs" if kind == "cable" else "ol", **common)
            table = "line"
        elif kind == "transformer_2w":
            rating, vk, vkr = get("sn_mva"), get("vk_percent"), get("vkr_percent")
            if rating <= 0 or vk <= 0 or vkr < 0 or vkr > vk:
                raise ModelError(f"Invalid transformer rating or impedance: {eid}")
            tap = get("tap")
            tap_args = {}
            if tap["kind"] == "fixed":
                tv = lambda key: value(tap[key], f"{eid}.tap.{key}")
                if tv("changer_type") != "ratio":
                    raise ModelError("Phase-shifting tap characteristic is not proven in Phase 1")
                position, lower, upper = tv("position"), optional(tap["min"]), optional(tap["max"])
                if ((lower is not None and position < lower) or (upper is not None and position > upper)
                        or any(int(n) != n for n in (position, tv("neutral")) + tuple(x for x in (lower, upper) if x is not None))):
                    raise ModelError("Invalid transformer tap position or limits")
                tap_args = {"tap_side": tv("side"), "tap_neutral": tv("neutral"),
                            "tap_pos": position, "tap_step_percent": tv("step_percent"),
                            "tap_step_degree": tv("step_degree"), "tap_changer_type": "Ratio"}
                if lower is not None:
                    tap_args["tap_min"] = lower
                if upper is not None:
                    tap_args["tap_max"] = upper
            elif tap["kind"] != "none":
                raise ModelError("Unsupported transformer tap capability")
            idx = pp.create_transformer_from_parameters(net, buses["hv"], buses["lv"], rating,
                get("vn_hv_kv"), get("vn_lv_kv"), vkr, vk, get("pfe_kw"), get("i0_percent"),
                shift_degree=get("phase_shift_degree"), parallel=int(get("parallel_count")), df=get("derating_factor"),
                **tap_args, **common)
            table = "trafo"
        elif kind in ("load", "motor"):
            if get("model") != "constant_pq":
                raise ModelError("Only constant-PQ loads/motors are supported")
            idx = pp.create_load(net, buses["bus"], get("p_mw"), get("q_mvar"),
                scaling=get("scaling_factor"), sn_mva=op("sn_mva"), const_z_p_percent=0,
                const_i_p_percent=0, const_z_q_percent=0, const_i_q_percent=0, **common)
            table = "load"
        elif kind == "shunt":
            if get("model") != "constant_impedance":
                raise ModelError("Only constant-impedance shunts are supported")
            idx = pp.create_shunt(net, buses["bus"], get("q_mvar"), get("p_mw"), vn_kv=get("nominal_kv"),
                                  step=int(get("step")), max_step=int(get("max_step")), **common)
            table = "shunt"
        elif kind in ("generator", "external_grid", "static_generator"):
            bus = buses["bus"]
            bounds = {key: op(key) for key in ("min_p_mw", "max_p_mw", "min_q_mvar", "max_q_mvar")}
            bounds = {k: v for k, v in bounds.items() if v is not None}
            if kind == "static_generator":
                idx = pp.create_sgen(net, bus, get("p_mw"), get("q_mvar"), sn_mva=op("sn_mva"), **bounds, **common)
                table = "sgen"
            else:
                vpu = get("voltage_setpoint_kv") / net.bus.at[bus, "vn_kv"]
                if vpu <= 0:
                    raise ModelError(f"Voltage setpoint must be positive: {eid}")
                if kind == "external_grid" and eid in slack_ids:
                    if get("mode") != "slack":
                        raise ModelError("Selected external grid is not in slack mode")
                    idx = pp.create_ext_grid(net, bus, vm_pu=vpu, va_degree=get("angle_degree"), **bounds, **common)
                    table = "ext_grid"
                elif kind == "external_grid":
                    if get("mode") != "voltage_controlled" or op("p_dispatch_mw") is None:
                        raise ModelError("Non-slack external grid needs explicit voltage-control mode and P dispatch")
                    idx = pp.create_gen(net, bus, op("p_dispatch_mw"), vm_pu=vpu, **bounds, **common)
                    table = "gen"
                elif eid in slack_ids:
                    if get("mode") != "slack" or op("slack_angle_degree") is None:
                        raise ModelError("Slack generator needs mode and angle confirmation")
                    # An ext_grid equivalent permits the explicitly declared angle;
                    # the canonical mapping preserves generator identity.
                    idx = pp.create_ext_grid(net, bus, vm_pu=vpu, va_degree=op("slack_angle_degree"), **bounds, **common)
                    table = "ext_grid"
                else:
                    if get("mode") != "pv":
                        raise ModelError("Unconfirmed slack generator")
                    # Null reactive bound is an explicit unconstrained capability.
                    for key in ("min_q_mvar", "max_q_mvar"):
                        value(d[key], f"{eid}.{key}", nullable=True)
                    idx = pp.create_gen(net, bus, get("p_mw"), vm_pu=vpu, sn_mva=op("sn_mva"), **bounds, **common)
                    table = "gen"
        else:
            raise ModelError(f"Unsupported element {kind}")
        element_to_native[eid] = (table, int(idx))
        mapping.append({"solver_id": f"{table}:{idx}", "solver_kind": "branch" if table in ("line", "trafo") else
                        "generator" if table in ("gen", "sgen", "ext_grid") else table,
                        "canonical_element_ids": [eid], "canonical_point_ids": list(terminals[eid].values()),
                        "terminal_ids": [t["id"] for t in e["terminals"].values()]})
    return {"net": net, "mappings": mapping, "root_to_bus": root_to_bus, "groups": groups,
            "busbars": busbars, "point_to_bus": {p: root_to_bus[uf.find(p)] for p in point_ids},
            "element_to_native": element_to_native, "kinds": kinds, "active": active,
            "excluded_ids": excluded_ids, "slack_ids": slack_ids,
            "energized_points": [p for p in point_ids if uf.find(p) in energized_roots]}


def number(x, reason="not_reported"):
    if x is None or not math.isfinite(float(x)):
        return {"status": "unavailable", "reason": reason}
    return {"status": "available", "value": float(x)}


def _quality(document):
    found = {"default": [], "library": [], "user": []}
    def visit(obj, path):
        if isinstance(obj, dict):
            if obj.get("status") == "known" and "provenance" in obj:
                source = obj["provenance"]["source"]
                if source in found:
                    found[source].append(path)
            for k, v in obj.items():
                visit(v, path + "/" + str(k))
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                visit(v, path + "/" + str(i))
    for section in ("meta", "settings", "elements"):
        visit(document[section], "/" + section)
    return {"defaulted_input_paths": found["default"], "library_input_paths": found["library"],
            "user_input_paths": found["user"], "dependencies": [{"result_path": "/results", "input_paths": sum(found.values(), []),
            "method": "conservative_connected_component"}]}


def solve_document(document, supplied_input_hash=None, *, runtime="native", runtime_version=None,
                   package_lock_digest="development"):
    """Return a schema-compatible SolutionRun; exceptions become explicit failures."""
    started, requested = time.perf_counter(), utcnow()
    settings = document["settings"]
    digest = supplied_input_hash or input_hash(document)
    tolerance = value(settings["solver_tolerance_mva"], "settings.solver_tolerance_mva")
    maximum = value(settings["max_iterations"], "settings.max_iterations")
    enforce = value(settings["enforce_q_limits"], "settings.enforce_q_limits")
    run = {"id": str(uuid.uuid4()), "model_revision": document["revision"], "input_hash": digest,
           "requested_at": requested, "completed_at": None, "status": "failed",
           "solver": {"backend": "pandapower", "backend_version": pp.__version__, "runtime": runtime,
              "runtime_version": runtime_version or platform.python_version(), "package_lock_digest": package_lock_digest,
              "algorithm": "newton_raphson", "tolerance_mva": tolerance, "max_iterations": maximum,
              "enforce_q_limits": enforce, "transformer_equivalent": "t"},
           "iterations": None, "timing": None, "diagnostics": [], "mappings": [],
           "energized_point_ids": [], "deenergized_point_ids": [], "quality": _quality(document), "results": None}
    converted = started
    try:
        if tolerance <= 0 or maximum < 1 or int(maximum) != maximum:
            raise ModelError("Solver tolerance and iteration count must be positive")
        context = to_pandapower(document)
        converted = time.perf_counter()
        net = context["net"]
        run["mappings"] = context["mappings"]
        run["energized_point_ids"] = context["energized_points"]
        run["deenergized_point_ids"] = [p["id"] for p in document["connectivity_points"] if p["id"] not in set(context["energized_points"])]
        pp.runpp(net, algorithm="nr", calculate_voltage_angles=True, init="dc", max_iteration=int(maximum),
                 tolerance_mva=tolerance, trafo_model="t", trafo_loading="current", enforce_q_lims=enforce,
                 check_connectivity=True, voltage_depend_loads=False, distributed_slack=False,
                 numba=False, lightsim2grid=False)
        run["status"] = "converged"
        run["iterations"] = int(net._ppc["iterations"])
        run["results"] = _results(document, context, run["iterations"])
    except pp.LoadflowNotConverged as exc:
        run["status"] = "nonconverged"
        run["diagnostics"].append(_finding(document, run["id"], "SOLVE.NONCONVERGED", str(exc)))
    except (ModelError, ValueError, KeyError, TypeError, np.linalg.LinAlgError) as exc:
        run["diagnostics"].append(_finding(document, run["id"], "SOLVE.INVALID_MODEL", str(exc)))
    end = time.perf_counter()
    run["completed_at"] = utcnow()
    run["timing"] = {"queue_ms": 0, "conversion_ms": (converted-started)*1000, "solve_ms": (end-converted)*1000,
                     "result_transfer_ms": 0, "redraw_ms": None, "total_ms": (end-started)*1000,
                     "runtime_warm": True, "measurement_environment": f"{runtime} Python {platform.python_version()}"}
    return run


def _finding(doc, run_id, rule, message):
    return {"id": str(uuid.uuid4()), "rule_id": rule, "rule_version": "1", "stage": "solver_diagnostic",
            "severity": "error", "blocks_solve": True, "message": message, "element_ids": [], "field_paths": [],
            "locations": [], "suggested_fix": "Review connectivity, source assignment and required engineering inputs.",
            "observed_value": None, "limit": None, "model_revision": doc["revision"], "solution_run_id": run_id,
            "status": "active", "cause_finding_ids": []}


def _results(document, context, iterations):
    net, result = context["net"], {k: [] for k in ("buses", "lines", "transformers", "generators", "external_grids", "loads", "shunts")}
    for root, idx in context["root_to_bus"].items():
        row = net.res_bus.loc[idx]
        live = math.isfinite(row.vm_pu)
        wrap = lambda x: number(x) if live else number(None, "deenergized")
        result["buses"].append({"busbar_ids": context["busbars"][root], "solver_bus_id": f"bus:{idx}", "energized": live,
            "voltage_pu": wrap(row.vm_pu), "voltage_kv": wrap(row.vm_pu * net.bus.at[idx, "vn_kv"]),
            "angle_degree": wrap(row.va_degree), "net_p_mw": wrap(-row.p_mw), "net_q_mvar": wrap(-row.q_mvar)})
    for e in document["elements"]:
        eid = e["id"]
        if eid not in context["element_to_native"]:
            continue
        table, idx = context["element_to_native"][eid]
        row = net["res_" + table].loc[idx]
        live = context["active"][eid] and eid not in context["excluded_ids"]
        wrap = lambda x: number(x) if live else number(None, "deenergized")
        kind = context["kinds"][eid]
        out = {"element_id": eid, "energized": live}
        if table in ("line", "trafo"):
            ends = ("from", "to") if table == "line" else ("hv", "lv")
            for end in ends:
                for field, unit in (("p", "mw"), ("q", "mvar"), ("i", "ka")):
                    key = f"{field}_{end}_{unit}"
                    out[key] = wrap(row[key])
            out.update(loading_percent=wrap(row.loading_percent), p_loss_mw=wrap(row.pl_mw), q_loss_mvar=wrap(row.ql_mvar))
            if table == "trafo":
                tap = optional(e["data"]["tap"])
                out["tap_position"] = number(optional(tap["position"])) if tap and tap["kind"] == "fixed" else number(None, "not_applicable")
            result["lines" if table == "line" else "transformers"].append(out)
        elif table in ("gen", "sgen", "ext_grid"):
            bus = net[table].at[idx, "bus"]
            lower, upper = optional(e["data"].get("min_q_mvar")), optional(e["data"].get("max_q_mvar"))
            out.update(p_mw=wrap(row.p_mw), q_mvar=wrap(row.q_mvar),
                       voltage_kv=wrap(net.res_bus.at[bus, "vm_pu"] * net.bus.at[bus, "vn_kv"]),
                       at_q_min=(bool(math.isclose(row.q_mvar, lower, abs_tol=1e-6)) if live and lower is not None else None),
                       at_q_max=(bool(math.isclose(row.q_mvar, upper, abs_tol=1e-6)) if live and upper is not None else None))
            result["external_grids" if kind == "external_grid" else "generators"].append(out)
        else:
            out.update(p_mw=wrap(row.p_mw), q_mvar=wrap(row.q_mvar))
            result["loads" if table == "load" else "shunts"].append(out)
    def total(table, column):
        return float(net["res_" + table][column].sum())
    unserved_p = unserved_q = 0.0
    for e in document["elements"]:
        if e["id"] in context["excluded_ids"] and context["kinds"][e["id"]] in ("load", "motor"):
            d = e["data"]
            unserved_p += value(d["p_mw"], "unserved load P") * value(d["scaling_factor"], "scaling")
            unserved_q += value(d["q_mvar"], "unserved load Q") * value(d["scaling_factor"], "scaling")
    system = {"converged": True, "iterations": iterations,
              "energized_bus_count": sum(b["energized"] for b in result["buses"]),
              "total_generation_mw": number(sum(total(t, "p_mw") for t in ("gen", "sgen", "ext_grid"))),
              "total_generation_mvar": number(sum(total(t, "q_mvar") for t in ("gen", "sgen", "ext_grid"))),
              "total_served_load_mw": number(total("load", "p_mw") + total("shunt", "p_mw")),
              "total_served_load_mvar": number(total("load", "q_mvar") + total("shunt", "q_mvar")),
              "total_unserved_load_mw": number(unserved_p), "total_unserved_load_mvar": number(unserved_q),
              "total_loss_mw": number(total("line", "pl_mw") + total("trafo", "pl_mw")),
              "total_loss_mvar": number(total("line", "ql_mvar") + total("trafo", "ql_mvar"))}
    for field, column in (("slack_p_mw", "p_mw"), ("slack_q_mvar", "q_mvar")):
        system[field] = number(sum(net["res_" + context["element_to_native"][eid][0]].at[context["element_to_native"][eid][1], column]
                                  for eid in context["slack_ids"]))
    result["system"] = system
    return result


def from_pandapower(net, fixture_id, template):
    """Convert supported native reference cases without rounding electrical data."""
    for table in ("trafo3w", "impedance", "ward", "xward", "dcline", "asymmetric_load", "asymmetric_sgen", "motor", "svc", "ssc", "tcsc", "vsc"):
        if table in net and len(net[table]):
            raise ModelError(f"Native {table} conversion is unsupported; no equipment was dropped")
    for col in ("const_z_p_percent", "const_i_p_percent", "const_z_q_percent", "const_i_q_percent"):
        if col in net.load and net.load[col].fillna(0).ne(0).any():
            raise ModelError("Native voltage-dependent loads cannot become constant-PQ loads silently")
    if len(net.switch) and net.switch.z_ohm.fillna(0).ne(0).any():
        raise ModelError("Non-ideal native switches are unsupported")
    doc = copy.deepcopy(template)
    doc["case_id"] = fixture_id
    doc["meta"].update(name=known(f"IEEE {len(net.bus)}-bus reference", fixture_id),
        frequency_hz=known(float(net.f_hz), fixture_id), base_mva=known(float(net.sn_mva), fixture_id),
        description=known("Bundled reference case from pandapower; solved live in the browser.", fixture_id),
        fixture_id=fixture_id, source_case_hash=hashlib.sha256(pp.to_json(net).encode()).hexdigest())
    for field in doc["settings"].values():
        if isinstance(field, dict) and field.get("status") == "known":
            field["provenance"] = known(None, fixture_id, source="default")["provenance"]
    doc["settings"]["slack_confirmed"] = known(True, fixture_id)
    doc["settings"]["base_confirmed"] = known(True, fixture_id)
    doc["connectivity_points"], doc["elements"] = [], []
    src = {"kind": "synthetic", "fixture_id": fixture_id, "generated_drawing": None}
    positions = {}
    for n, index in enumerate(net.bus.index):
        angle = 2 * math.pi * n / len(net.bus)
        positions[index] = {"x": round(520 + 330 * math.cos(angle)), "y": round(390 + 280 * math.sin(angle))}
        doc["connectivity_points"].append({"id": f"point-{index}", "position": positions[index], "source_ref": copy.deepcopy(src),
                                          "kind": "junction", "evidence": []})
    def base(eid, kind, label, service, ends, data):
        position = positions[next(iter(ends.values()))]
        return {"id": eid, "label": known(str(label) if label is not None else eid, fixture_id),
            "type": known(kind, fixture_id), "in_service": known(bool(service), fixture_id), "source_ref": copy.deepcopy(src),
            "layout": {"position": copy.deepcopy(position), "rotation_degree": 0, "width": None, "height": None,
                       "route_points": [], "page_group": None, "bay_group": None, "updated_at": "2026-11-13T00:00:00Z"},
            "review": {"status": "confirmed", "reviewed_revision": 0, "reviewed_at": "2026-11-13T00:00:00Z"},
            "station": known(None, fixture_id), "bay": known(None, fixture_id), "notes": known(None, fixture_id),
            "terminals": {role: {"id": f"{eid}:{role}", "role": role, "connection_point": known(f"point-{idx}", fixture_id),
                "source_ref": copy.deepcopy(src), "drawn_anchor": None} for role, idx in ends.items()},
            "data": {k: known(v, fixture_id) for k, v in data.items()}}
    def nv(row, key, default=None):
        v = row.get(key, default)
        return default if v is None or (isinstance(v, (float, np.floating)) and math.isnan(v)) else v
    for idx, row in net.bus.iterrows():
        doc["elements"].append(base(f"bus-{idx}", "busbar", row["name"], row.in_service, {"bus": idx},
            {"nominal_kv": row.vn_kv, "voltage_min_pu": nv(row, "min_vm_pu"), "voltage_max_pu": nv(row, "max_vm_pu")}))
    for idx, row in net.line.iterrows():
        doc["elements"].append(base(f"line-{idx}", "cable" if row.type == "cs" else "line", row["name"], row.in_service,
            {"from": row.from_bus, "to": row.to_bus}, {"length_km": row.length_km, "r_ohm_per_km": row.r_ohm_per_km,
             "x_ohm_per_km": row.x_ohm_per_km, "b_us_per_km": row.c_nf_per_km * 2 * math.pi * net.f_hz / 1000,
             "g_us_per_km": row.g_us_per_km, "max_current_ka": row.max_i_ka, "derating_factor": row.df,
             "parallel_count": int(row.parallel), "standard_type": None,
             "from_nominal_kv": net.bus.at[row.from_bus, "vn_kv"], "to_nominal_kv": net.bus.at[row.to_bus, "vn_kv"]}))
    for idx, row in net.trafo.iterrows():
        data = {key: row[key] for key in ("sn_mva", "vn_hv_kv", "vn_lv_kv", "vk_percent", "vkr_percent", "pfe_kw", "i0_percent")}
        data.update(phase_shift_degree=row.shift_degree, parallel_count=int(row.parallel), derating_factor=row.df, standard_type=None)
        if nv(row, "tap_side") is None:
            data["tap"] = {"kind": "none"}
        else:
            if nv(row, "tap_changer_type") not in ("Ratio", None):
                raise ModelError("Unsupported native tap characteristic")
            data["tap"] = {"kind": "fixed", **{key: known(val, fixture_id) for key, val in {
                "side": row.tap_side, "neutral": int(row.tap_neutral), "min": row.tap_min, "max": row.tap_max,
                "position": int(row.tap_pos), "step_percent": row.tap_step_percent,
                "step_degree": nv(row, "tap_step_degree", 0.0), "changer_type": "ratio",
                "ratio_definition": "pandapower Ratio: positive step changes the tapped winding voltage"}.items()}}
            if nv(row, "tap_step_degree") is None:
                data["tap"]["step_degree"] = known(0.0, fixture_id, source="default",
                    rationale="Native Ratio transformer omits tap phase increment; its solver uses zero phase increment. Explicitly adopted for the reference conversion.")
        doc["elements"].append(base(f"trafo-{idx}", "transformer_2w", row["name"], row.in_service,
                                    {"hv": row.hv_bus, "lv": row.lv_bus}, data))
    for idx, row in net.ext_grid.iterrows():
        eid = f"grid-{idx}"
        data = {"voltage_setpoint_kv": row.vm_pu * net.bus.at[row.bus, "vn_kv"], "angle_degree": row.va_degree,
                "infeed_rating_mva": float("nan"), "p_dispatch_mw": None, "mode": "slack"}
        data.update({key: nv(row, key) for key in ("min_p_mw", "max_p_mw", "min_q_mvar", "max_q_mvar")})
        doc["elements"].append(base(eid, "external_grid", row["name"], row.in_service, {"bus": row.bus}, data))
        doc["settings"]["slack_element_id"] = known(eid, fixture_id)
    for idx, row in net.gen.iterrows():
        data = {"p_mw": row.p_mw * row.scaling, "voltage_setpoint_kv": row.vm_pu * net.bus.at[row.bus, "vn_kv"],
                "sn_mva": row.sn_mva, "mode": "slack" if nv(row, "slack", False) else "pv", "slack_angle_degree": None}
        data.update({key: nv(row, key, float("nan") if "_p_" in key else None) for key in ("min_p_mw", "max_p_mw", "min_q_mvar", "max_q_mvar")})
        element = base(f"gen-{idx}", "generator", row["name"], row.in_service, {"bus": row.bus}, data)
        if data["mode"] == "slack":
            element["data"]["slack_angle_degree"] = known(0.0, fixture_id, source="default",
                rationale="Native generator slack reference angle is zero; explicitly adopted for reference conversion.")
            doc["settings"]["slack_element_id"] = known(f"gen-{idx}", fixture_id)
        doc["elements"].append(element)
    for idx, row in net.sgen.iterrows():
        data = {"p_mw": row.p_mw * row.scaling, "q_mvar": row.q_mvar * row.scaling, "sn_mva": row.sn_mva, "technology": "other"}
        data.update({key: nv(row, key, float("nan")) for key in ("min_p_mw", "max_p_mw", "min_q_mvar", "max_q_mvar")})
        doc["elements"].append(base(f"sgen-{idx}", "static_generator", row["name"], row.in_service, {"bus": row.bus}, data))
    for idx, row in net.load.iterrows():
        doc["elements"].append(base(f"load-{idx}", "load", row["name"], row.in_service, {"bus": row.bus},
            {"p_mw": row.p_mw, "q_mvar": row.q_mvar, "scaling_factor": row.scaling, "sn_mva": nv(row, "sn_mva"),
             "power_factor": None, "reactive_kind": "lagging" if row.q_mvar >= 0 else "leading", "model": "constant_pq"}))
    for idx, row in net.shunt.iterrows():
        doc["elements"].append(base(f"shunt-{idx}", "shunt", row["name"], row.in_service, {"bus": row.bus},
            {"p_mw": row.p_mw, "q_mvar": row.q_mvar, "nominal_kv": row.vn_kv, "step": int(row.step),
             "max_step": int(row.max_step), "technology": "capacitor" if row.q_mvar < 0 else "reactor", "model": "constant_impedance"}))
    # Native branch switches require distinct terminal points; a direct branch
    # connection must never bypass its explicit switching device.
    for idx, row in net.switch.iterrows():
        eid = f"switch-{idx}"
        switch = base(eid, "circuit_breaker", row["name"], True, {"a": row.bus, "b": row.bus},
            {"state": "closed" if row.closed else "open", "normal_state": "closed" if row.closed else "open",
             "rated_current_ka": nv(row, "in_ka", float("nan")), "rated_voltage_kv": net.bus.at[row.bus, "vn_kv"], "electrical_model": "ideal"})
        if row.et == "b":
            switch["terminals"]["b"]["connection_point"] = known(f"point-{row.element}", fixture_id)
        elif row.et in ("l", "t"):
            branch_id = ("line-" if row.et == "l" else "trafo-") + str(row.element)
            branch = next(e for e in doc["elements"] if e["id"] == branch_id)
            role = next((r for r, t in branch["terminals"].items() if t["connection_point"]["value"] == f"point-{row.bus}"), None)
            if role is None:
                raise ModelError("Native branch switch bus does not match an endpoint")
            point = f"point-{eid}"
            doc["connectivity_points"].append({"id": point, "position": copy.deepcopy(positions[row.bus]),
                "source_ref": copy.deepcopy(src), "kind": "terminal_point", "evidence": []})
            switch["terminals"]["b"]["connection_point"] = known(point, fixture_id)
            branch["terminals"][role]["connection_point"] = known(point, fixture_id)
        else:
            raise ModelError("Unsupported native switch kind")
        doc["elements"].append(switch)
    doc["review"].update(status="confirmed", confirmed_model_revision=0,
                        confirmed_at="2026-11-13T00:00:00Z", confirmed_input_hash=input_hash(doc))
    return doc
