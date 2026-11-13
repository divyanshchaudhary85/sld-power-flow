# SLD Power Flow

A browser-local workspace that turns a reviewed single-line diagram into a traceable AC power-flow study. Upload and inspect a drawing, complete its engineering data, solve with real pandapower, operate the simulated network and export the case with its results.

**Study mode only: this application never controls physical equipment.**

[Open the live application](https://divyanshchaudhary85.github.io/sld-power-flow/) · [Open the project in your IDE](START-HERE.md) · [Release verification and limitations](docs/release-verification.md)

![SLD Power Flow operator console](docs/images/study-console.jpg)

## What is implemented

- Local PDF, PNG, JPEG and multipage TIFF ingestion, PDF text extraction, scan correction and overlapping image tiles.
- Optional direct OpenAI vision extraction using the visitor's own key, with schema validation, request limits, low-confidence rereads and deterministic graph reconstruction.
- Side-by-side source and reconstructed drawing review; linked selection; add, remove, retype and reconnect equipment; explicit correction of unresolved wire endpoints.
- The 24-rule engineering catalog, native pandapower diagnostics, missing-data completion, explicit standard-type/default acceptance and an assumptions register.
- Actual balanced positive-sequence Newton–Raphson AC power flow in a Pyodide Web Worker, with revision/hash checks that reject stale results.
- An operator console with switching, service changes, load/generator setpoints, fixed taps, base reset/comparison, findings, tables and simulated event history.
- Canonical JSON, pandapower JSON, MATPOWER MAT, PSS/E RAW v33, XLSX, CSV and PDF exports. Study ZIPs include the canonical case and conversion notes.
- Browser-local open-case/drawing storage, dark/light themes, keyboard-operable controls and a static GitHub Pages deployment.

Implemented features and completed acceptance checks are different claims. The [release verification report](docs/release-verification.md) records executed checks, measured browser timings and outstanding work. **Live-key vision testing was deferred by the user; real-world extraction accuracy and opening RAW in actual Siemens PSS/E remain unverified.** Synthetic extraction tests do not establish real drawing accuracy. The [Phase 1 report](docs/phase-1.md) remains a historical record, not the current feature list.

## Try it without a key

1. Open the site, select **IEEE 9-bus** or **IEEE 14-bus**, wait for the local numerical engine, and choose **Solve in browser**.
2. Inspect the native-reference comparison, bus voltages, flows, loading, losses and findings. Reference voltage tolerance is `1e-6 pu`.
3. Select **Breaker isolation**, select its breaker, open the Inspector's **operate** tab, and confirm an action. An intentional outage remains visible; dead equipment does not receive fabricated numerical results.
4. Use **Validate** and **Complete data**, or inspect the full canonical document under **Case & settings**. Engineering changes require a new review.
5. Open **Export study** after a converged solve to download a study bundle. **Save case** also saves canonical JSON directly.

The **50-bus study** is an explicitly synthetic feeder, not an IEEE reference case. Its browser solve-plus-redraw evidence is reported separately from native Python and Node/WebAssembly timings.

For an uploaded drawing, choose **Upload & extract**, review the privacy statement, and load a local file. You can build the model manually without a key. Vision extraction sends selected tiles, legend crops and nearby text only after consent. Inspect and correct the resulting draft, resolve wire-end findings, complete missing data, confirm the model and solve. See [the extraction guide](docs/extraction.md).

## Clean setup on Windows

Use Node.js **22.17.1** and Python **3.13.5**, matching CI. Git is needed only if cloning; an extracted source folder works too. In PowerShell:

```powershell
git clone https://github.com/divyanshchaudhary85/sld-power-flow.git
cd sld-power-flow
npm.cmd ci
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
$env:PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
npm.cmd run provision:runtime
npm.cmd run dev
```

Open the address printed by Vite, normally `http://127.0.0.1:5173/sld-power-flow/`. The first setup downloads locked dependencies and approximately 47 MB of numerical assets. Provisioning verifies their hashes and writes the ignored `public/runtime/` folder. Re-run provisioning after changing either Python adapter/exporter. Use the server; do not double-click `index.html`.

[START-HERE.md](START-HERE.md) contains macOS/Linux commands, VS Code tasks, other IDE instructions, troubleshooting and a guided code walkthrough.

## Project map

```text
src/App.tsx          Workspace screens and composition
src/ui/              Diagram, source view, Inspector, dialogs and tables
src/model/           Canonical types, schema boundary, edits and review hashes
src/ingestion/       Local file decoding, coordinates, deskew and tiles
src/extraction/      Vision requests, merge, graph draft and evaluation
src/completion/      Missing data, standard types and explicit defaults
src/validation/      Pure rules and topology analysis
src/solver/          Worker protocol, browser adapter and Pyodide runtime
src/exports/         Tabular and document output
python/              Actual pandapower conversion, solve, diagnostics and exporters
schema/              Versioned JSON contracts
public/fixtures/     Labelled samples and committed reference evidence
tests/               Frontend/model tests, native tests and runtime proof
scripts/             Runtime provisioning, static assets and evaluation utilities
docs/                Architecture, phase reports and verification evidence
```

Start with [the architecture/dataflow guide](docs/architecture.md), then follow one selected equipment ID from its canonical input through validation, the Python conversion and the result mapping. All stages share one `StudyDocument`. Every engineering value is known with provenance or explicitly missing; an offered default is not an accepted input. The vision model never calculates an electrical result.

## Verify a change

After setup, in PowerShell:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
.\.venv\Scripts\python.exe -m pytest tests/python
npm.cmd run provision:runtime
npm.cmd run test:runtime
.\.venv\Scripts\python.exe tests/python/verify_runtime_raw.py
npm.cmd run build
npm.cmd run preview
```

Native tests run actual pandapower. The runtime proof runs actual Pyodide/pandapower with network access blocked, including fixture solves, diagnostics and exports. The separate RAW step independently parses the WebAssembly-generated files and re-solves them. Committed reference fixtures are not regenerated in CI. Numerical export tolerance is `1e-4 pu`; tested format transformations and limits are documented in [Phase 4](docs/phase-4.md).

CI requires its lint, type, unit, native, runtime and build checks before deploying `main`. See [CI details](docs/ci.md). A green automated run does not substitute for an actual browser interaction, live provider request, real-drawing evaluation or PSS/E check.

## Privacy and scope

There is no login, analytics, application backend or shipped API key. Calculations and case data stay in the visitor's browser. Source drawing bytes are stored locally and referenced by ID; canonical JSON does not embed them. Keep original drawings separately when moving a case to another browser.

Optional vision requests send image tiles and nearby text directly to OpenAI with the visitor's key. The key is kept in memory and cleared when leaving the panel; it is not saved in browser storage or case files. Requests use `store:false`; [provider data-retention rules](https://developers.openai.com/api/docs/guides/your-data) still apply. Keep private development files in the ignored `private/` directory and never commit credentials or private drawings.

Scope is steady-state, balanced positive-sequence AC for up to 50 reduced electrical buses. Phase unbalance, short-circuit, protection coordination, dynamics, contingency analysis, three-winding transformers and live SCADA are excluded. Phase-shifting tap characteristics and direct busbar service outages are rejected explicitly. Loads/motors use constant PQ, and static generation does not automatically form an island. Numerical interchange files are reduced snapshots; retain canonical JSON and read each export's warnings. Actual Siemens PSS/E verification remains a user step.

## Documentation and licences

[Model contract](docs/model.md) · [Validation catalog](docs/phase-2.md) · [Operator console](docs/phase-3.md) · [Exports](docs/phase-4.md) · [Drawing pipeline](docs/phase-5.md) · [Release checks](docs/phase-6.md) · [Runtime](docs/browser-runtime.md)

Application code is [MIT](LICENSE). Both bundled Inter 4.1 font files use [SIL OFL 1.1](public/notices/Inter-LICENSE.txt): the WOFF2 interface font and the TTF embedded in PDF reports. Their SHA-256 hashes are checked when preparing static assets. The build writes exact JavaScript package/font notices to `notices/dependencies.json`; numerical package manifests and notices accompany the runtime. These distributions retain their respective licences.
