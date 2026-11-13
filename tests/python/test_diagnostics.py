import copy
import json

import pandapower as pp
from jsonschema import Draft202012Validator

from test_adapter import ROOT, fixture
from solver_adapter import diagnose_document, from_pandapower


def test_native_diagnostics_map_affected_bus_to_canonical_and_do_not_mutate():
    native, _ = fixture()
    pp.create_gen(native, 0, p_mw=1, vm_pu=1, min_q_mvar=-10, max_q_mvar=10)
    doc = from_pandapower(native, "duplicate-controller", json.loads((ROOT / "schema/fixture-template.json").read_text()))
    before = copy.deepcopy(doc)
    results = diagnose_document(doc)
    assert doc == before
    finding = next(f for f in results if f["rule_id"] == "PP_MULTIPLE_VOLTAGE_CONTROLLING_ELEMENTS_PER_BUS")
    assert "bus-0" in finding["element_ids"]
    assert finding["blocks_solve"]
    assert finding["model_revision"] == doc["revision"]
    schema = json.loads((ROOT / "schema/study-document.schema.json").read_text())
    validator = Draft202012Validator({"$ref": "#/$defs/Finding", "$defs": schema["$defs"]})
    for f in results:
        validator.validate(f)


def test_native_diagnostics_report_adapter_precondition():
    _, doc = fixture()
    doc["review"]["status"] = "draft"
    results = diagnose_document(doc)
    assert len(results) == 1
    assert results[0]["rule_id"] == "NATIVE_MODEL_PRECONDITION"
    assert results[0]["blocks_solve"]


def test_reference_diagnostics_neither_error_nor_block_valid_reference():
    for case in ("case9", "case14"):
        _, doc = fixture(case)
        findings = diagnose_document(doc)
        assert not any(f["blocks_solve"] for f in findings)
        assert not any(f["rule_id"] == "NATIVE_DIAGNOSTIC_ERROR" for f in findings)
