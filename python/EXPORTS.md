# Native export and diagnostic contract

`exporters.export_document(document, format)` accepts `pandapower-json`,
`matpower`, or `psse-raw`. It converts and solves the current reviewed document,
then returns `{format, filename, mime_type, encoding, data, warnings,
model_revision, input_hash, bus_map}`. `encoding` is `utf-8` for native JSON/RAW
and `base64` for binary MAT. The caller must present `warnings` and include the
canonical JSON alongside exports. The returned hash is Python's native hash;
the browser continues to use its own supplied hash for SolutionRun matching.

`bus_map` maps native bus indices to the bus numbers written in each file.
MATPOWER's importer subtracts one from the file's bus numbers. Unsupported,
incomplete, asymmetric or nonconvergent cases raise explicit exceptions.

Native JSON retains the converted pandapower network and solution. All formats
are numerical snapshots after ideal-switch reduction. Canonical JSON preserves
the original node-breaker model, provenance, inactive equipment and source links.
MAT/RAW aggregate constant-PQ injections. Exported transformer taps are fixed at
their current ratio. Pandapower produces an equivalent pi network from the T
model; branch conductance and RAW transformer charging are moved to terminal
bus shunts with the tap ratio included. This preserves the nodal admittance.
Unknown machine MBASE uses the system base only for unused machine-impedance
fields. It must not be interpreted as a nameplate rating.

RAW is version 33, balanced steady state only. The writer supports buses, fixed
PQ injections, generators, fixed bus shunts, branches and fixed two-winding
transformers. Ownership/area/zone/disabled control fields and non-operational
machine impedance fields use explicit format placeholders, described in the
download warnings. No dynamics or short-circuit capability is implied.

Run `python -m pytest tests/python` for the numerical tests and
`python tests/python/verify_exports.py` to regenerate measured
`public/fixtures/export-proof.json`. JSON, MAT and RAW are re-read and re-solved
for IEEE9 and IEEE14 with tolerance 1e-4 pu. Additional tests cover magnetizing
losses, line shunt conductance, static injection and reactive-limit saturation.
MAT/RAW re-imports use the exported pi equivalent.

The independent reader is LANL-ANSI's BSD-3-Clause `grg-pssedata==0.1.4`, a test
dependency that does not ship to browsers. Its parser interprets the RAW records;
the test bridge converts those parsed records to pandapower for the re-solve.
Three bugs in its optional validator require test-only namespace/reporting-ID
shims. Its warnings for allowed unused zero owner/control/table identifiers are
acknowledged narrowly; no numerical data or parsing logic is patched. Actual
Siemens PSS/E software verification remains a user step. The independent parser
check is not certification by PSS/E and is not a second independent solver.

`solver_adapter.diagnose_document(document, solution_run_id=None)` returns
schema-compatible Finding records. All pandapower 3.3.3 registered diagnostics
run on a disposable network except numba comparison, since numba is deliberately
disabled. Native check exceptions become warnings instead of a claimed pass.
The installed library has a nominal-voltage argument spelling mismatch; the
adapter binds the implementation's spelling to the user's configured tolerance.
Upper-bound impedance plausibility checks remain warnings. Other invalid native
inputs block solving. Findings use PP_/NATIVE_ rule IDs, canonical element IDs,
source locations when available, the current revision and optional solution ID.
Failed convergence automatically includes these diagnostics. They are additional
library heuristics, not a replacement for the deterministic canonical rule set.

Result-quality dependency paths are JSON Pointer prefixes: a row uses
`/results/{table}/{index}`, or `/results/{table}` when every row has identical
dependencies. Match an exact path or a descendant separated by `/`, then
intersect the dependency's exact `input_paths` with `defaulted_input_paths`.
There is no blanket `/results` dependency. Inputs cover the actual connected
component plus global electrical solver inputs; metadata and display defaults
do not mark electrical values. System aggregates cover all components. An
inherited nominal voltage base retains its origin even when propagated across
an open switch. No dependency claims are emitted when no results exist.

Primary API references:

- https://pandapower.readthedocs.io/en/v3.3.3/converter/matpower.html
- https://pandapower.readthedocs.io/en/v3.3.3/powerflow/diagnostic.html
- https://grg-pssedata.readthedocs.io/en/latest/grg_pssedata.html
- https://github.com/lanl-ansi/grg-pssedata
