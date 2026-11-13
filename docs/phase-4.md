# Phase 4: native exports, diagnostics and numerical evidence

The native backend exports pandapower JSON, binary MATPOWER v2 `.mat`, and PSS/E
RAW v33 from the current reviewed canonical input. Every export runs a fresh
native solve. The canonical case remains the editable, lossless companion.
Worker integration, completion UI, workbook/CSV/PDF presentation and browser
download packaging are covered by their frontend tests and release checks.

## Measured round trips

`tests/python/verify_exports.py` writes the execution-generated evidence at
`public/fixtures/export-proof.json`. Each exported file is read back and its
bus voltages are solved again. The configured tolerance is 1e-4 pu.

| Fixture     | pandapower JSON | MATPOWER MAT | PSS/E RAW v33 |
| ----------- | --------------: | -----------: | ------------: |
| IEEE 9-bus  |            0 pu |         0 pu |          0 pu |
| IEEE 14-bus |            0 pu |         0 pu |          0 pu |

These numbers are maximum absolute bus-voltage differences from the executed
native reference, not manually entered expected electrical results. Native
adapter and browser-runtime reference comparisons remain separate proofs.
The exporter tests also exercise nonzero magnetizing loss, line conductance,
static generation and saturated reactive limits. Reactive-limit snapshots
retain the final solved PQ/PV control state.

The actual Pyodide runtime also generated all three formats with network access
disabled. Its JSON/MAT exports re-imported and re-solved inside WebAssembly with
maximum differences 0 pu (IEEE9) and 4.762e-10 pu (IEEE14). Its actual RAW files
were independently parsed with grg and re-solved natively: 3.331e-16 pu (IEEE9)
and 4.762e-10 pu (IEEE14) versus the native fixture reference. Evidence is in
`test-results/runtime-proof.json` and
`test-results/runtime-exports/raw-independent-proof.json`.

## Format conventions and limits

The pandapower T model is converted by pandapower into its equivalent pi network.
For standard MAT/RAW compatibility, branch conductance becomes terminal bus
shunts. RAW transformer charging also becomes terminal bus shunts, accounting
for the tap ratio. The comparison re-imports use the exported pi equivalent.
The native JSON comparison retains the T model.

MAT/RAW represent reduced bus-branch snapshots: constant-PQ injections aggregate
at a bus, closed ideal switches reduce, fixed taps retain their current ratio,
and out-of-service/de-energized equipment is omitted from those numerical
formats. Native JSON also uses the adapter's reduced buses. The canonical JSON
preserves the full explicit switching model, provenance and source links.

Every export returns warnings explaining these transformations. RAW ownership,
area, zone and disabled-control fields are file placeholders. Missing machine
MBASE uses the system base for unused impedance fields, and does not assert a
nameplate rating. No dynamics, short-circuit, protection or unbalanced analysis
is supported. Unsupported asymmetry and incomplete inputs fail explicitly.

## Independent RAW check

The independently maintained LANL-ANSI `grg-pssedata==0.1.4` parser (BSD-3-Clause)
reads each RAW file before the round-trip re-solve. The test bridge maps its
parsed records to pandapower. This is an independent reader check; the numerical
solver is still pandapower, and the check is not PSS/E certification.

The reader's optional validator has old implementation defects: omitted imports
for `warnings` and `PSSEDataWarning`, and an unset parent ID used only in warning
messages. Test-only shims supply those names; parser logic and interpreted
electrical fields are untouched. Its false-positive warnings for unused zero
owner/control/impedance-table IDs are acknowledged narrowly. Other validator
warnings fail the test. No third-party source file is modified.

Opening the exported RAW file in actual Siemens PSS/E remains a user verification
step. It has not been claimed complete. `grg-pssedata` is a development dependency
only; it adds nothing to the shipped browser runtime.

## Native diagnostics

`diagnose_document(document, solution_run_id=None)` executes the installed
pandapower 3.3.3 diagnostics on a disposable converted network. All registered
checks run except numba comparison, because the app disables numba. Nonconvergent
solves automatically attach the returned findings. Findings identify the current
canonical revision and affected element/source regions; unsuccessful checks
report a warning instead of pretending to pass.

The adapter explicitly corrects the installed diagnostic registration's
`nominal_voltage_tolerance`/`nom_voltage_tolerance` spelling mismatch and applies
the canonical user threshold. Library impedance upper-bound heuristics remain
warnings: the IEEE14 conversion uses scaled equipment bases and legitimately
triggers those heuristics. Invalid native types/required ranges and conflicting
voltage controllers block solving. Canonical TS validation remains the first
validation layer.

## Additional fixtures and performance

`case9-breaker.json` adds a closed load-isolating breaker without changing the
IEEE9 solution. `breaker-load` isolates `load-0` via `point-isolatable-load` when
the operation explicitly records an intentional outage.

`case50.json` is an explicitly labelled synthetic 50-bus feeder, not an IEEE
reference case. Five measured warm native conversions/solves took 628–737 ms
on this Windows host. The raw timings and native voltage comparisons are in
`public/fixtures/native-proof.json`. This does not measure browser redraw;
the browser performance proof must be reported separately.

The final network-disabled Node/Pyodide proof solved the synthetic 50-bus case
in 1,309 ms after runtime load in the final recorded run, with maximum native voltage difference below
1e-15 pu. That is a measured WebAssembly solve, still excluding DOM redraw.
IEEE9, IEEE14 and the breaker fixture also passed that runtime proof.

The complete native Python suite passed 33 tests. Six upstream deprecation and
dtype warnings were emitted; no numerical test failed. `pip check` reported no
broken dependency requirements.

## Reproduce

```sh
python -m pip install -r requirements-dev.txt
python -m pytest tests/python
python scripts/generate_fixtures.py
python tests/python/verify_exports.py
npm run provision:runtime
npm run test:runtime
python tests/python/verify_runtime_raw.py
```

For a restricted Windows temp directory, create `work/` and pass
`--basetemp=work/pytest-native` to pytest. Runtime proof outputs are generated
under ignored `test-results/`.

References: [pandapower MAT converter](https://pandapower.readthedocs.io/en/v3.3.3/converter/matpower.html),
[pandapower diagnostics](https://pandapower.readthedocs.io/en/v3.3.3/powerflow/diagnostic.html),
[grg parser documentation](https://grg-pssedata.readthedocs.io/en/latest/grg_pssedata.html),
[grg source and licence](https://github.com/lanl-ansi/grg-pssedata).

## Actual browser download check

Both generated IEEE 9-bus ZIP downloads were read back from disk. Each contained all six requested export formats plus canonical JSON and conversion notes. The three native formats in each ZIP were independently re-imported and solved: all six comparisons differed from the contained canonical solution by at most `7.771561172376096e-16 pu`. The workbook had nine sheets and nine bus rows; the PDF reopened with the expected sections. See [the recorded browser-export evidence](evidence/browser-export.json). The final compact report layout is separately rendered and checked at code level after the browser automation interruption.
