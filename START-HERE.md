# Start here

Open this `sld-power-flow` folder in your IDE: the folder containing `package.json`, `src/`, `python/` and this file. It contains both the browser application and the native reference/test code. There is no application server or database service to start.

The application supports a reviewed, balanced positive-sequence AC study. Its operator controls simulate a case; they never operate physical equipment. You can learn and run the supplied cases without an API key. Real drawing extraction is optional and requires your own provider key plus explicit consent; its real-world accuracy remains unmeasured.

Live-key vision testing was deferred by the user. Actual Siemens PSS/E verification also remains outstanding. The implemented workflow and the checks actually executed are listed separately in [release verification](docs/release-verification.md); do not read a completed feature as proof that every acceptance condition passed.

If you need a clean copy rather than the supplied folder, run `git clone https://github.com/divyanshchaudhary85/sld-power-flow.git`, then `cd sld-power-flow`. Run the remaining commands inside that folder. Git is not needed merely to run an extracted source archive.

## First run on Windows

Install Node.js **22.17.1** and Python **3.13.5**, the versions used by CI. Open a PowerShell terminal inside this folder. These commands use the virtual environment directly, so activating a PowerShell script is unnecessary.

```powershell
node --version
py -3.13 --version
npm.cmd ci
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
$env:PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
npm.cmd run provision:runtime
npm.cmd run dev
```

Open the local address printed by Vite, normally `http://127.0.0.1:5173/sld-power-flow/`. Keep the terminal open. Stop the server with Ctrl+C.

The first setup needs internet access to install locked packages and download about 47 MB of numerical runtime assets. Provisioning verifies their hashes and writes `public/runtime/`. Subsequent solves execute in a Web Worker in your browser. Do not open `index.html` by double-clicking it; use the local development server.

## First run on macOS or Linux

Use the same Node/Python versions. From the project folder:

```sh
npm ci
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
export PYTHON="$PWD/.venv/bin/python"
npm run provision:runtime
npm run dev
```

The operating-system setup commands are provided for portability; the release's local interactive checks were performed on Windows. CI runs the locked checks on Ubuntu.

## VS Code and other IDEs

In VS Code, use **File → Open Folder** and select this folder. The optional recommended extensions provide ESLint and Python support; TypeScript support is built in. Select the `.venv` interpreter with **Python: Select Interpreter** if it is not discovered automatically. Use **TypeScript: Select TypeScript Version → Use Workspace Version** to match the installed compiler.

After the first setup, **Terminal → Run Task** offers development, tests, runtime provisioning, build and preview tasks. **Verify all** runs the same main checks sequentially. Tasks use `.venv/Scripts/python.exe` on Windows and `.venv/bin/python` elsewhere. They do not create the virtual environment for you. Run **Build static site** before **Preview production build**.

For WebStorm, IntelliJ IDEA, PyCharm with JavaScript support, Cursor or another editor, open this same folder, select its Node interpreter and `.venv` Python interpreter, and run the terminal commands in this guide. The source does not depend on VS Code. Configure npm scripts from `package.json` if your IDE provides a script runner. Use the browser's Developer Tools for UI/Worker debugging, and your IDE's Python debugger for `tests/python/test_adapter.py` or an individual pytest case.

The optional editor files follow the official [VS Code task model](https://code.visualstudio.com/docs/debugtest/tasks), [workspace extension recommendations](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_workspace-recommended-extensions) and [Python environment settings](https://code.visualstudio.com/docs/python/settings-reference).

## Learn the application in one short session

1. Select **IEEE 9-bus**, wait for the numerical engine, and choose **Solve in browser**. Inspect voltages, branch flows and the native-reference comparison.
2. Select an element in the diagram. Follow its canonical ID into **Case & settings** and inspect its input value, units and provenance.
3. Open **Validate**, then **Complete data**. A missing quantity is different from zero; accepting a displayed default is an explicit action.
4. Use the **Breaker isolation** sample, select its breaker, and confirm an open/close action. Inspect the event log, outage finding and served/unserved load after the solve.
5. Save the canonical JSON. Reopen it through **Open canonical JSON**: imported approval and base snapshots are deliberately not trusted. Inspect and confirm the model before solving it again.

For a drawing workflow, read [drawing ingestion and extraction](docs/extraction.md), use **Upload & extract**, then review the original drawing beside the reconstructed network. A valid model response is not proof of electrical correctness. Missing or conflicting readings remain visible for correction. Use **Unresolved drawing endpoints** to focus a wire end, attach its actual net to an equipment terminal/connection point, or explicitly classify a non-electrical mark with a reason. Correcting a terminal elsewhere does not automatically dismiss that separate drawing observation.

## Where to read and change code

| Goal | Start with |
| --- | --- |
| Understand the whole flow | [Architecture guide](docs/architecture.md) |
| Change layout or UI behavior | `src/App.tsx`, `src/ui/`, `src/styles.css` |
| Understand an input or result field | `src/model/types.ts`, `schema/study-document.schema.json` |
| Edit engineering inputs safely | `src/model/editing.ts`, `src/model/revision.ts` |
| Add or diagnose an engineering rule | `src/validation/`, `tests/validation.test.ts` |
| Understand missing values/default acceptance | `src/completion/` |
| Trace an operator action or async solve | `src/operations.ts`, `src/useWorkspace.ts`, `tests/operations.test.ts` |
| Change actual numerical conversion | `python/solver_adapter.py`, `tests/python/test_adapter.py` |
| Understand the browser Python runtime | `src/solver/`, [runtime guide](docs/browser-runtime.md) |
| Work on perception and reconstruction | `src/ingestion/`, `src/extraction/`, [extraction guide](docs/extraction.md) |
| Resolve a dangling drawing wire | `src/model/endpointReview.ts`, `src/ui/EndpointReview.tsx` |
| Understand keyboard-safe confirmations | `src/ui/ConfirmDialog.tsx`, `tests/confirm-dialog.test.ts` |
| Change exports | `src/exports/`, `python/exporters.py`, [native export contract](python/EXPORTS.md) |

A useful first code exercise is to alter a display label or add a narrowly scoped rule test. For an engineering behavior change, make a failing test with a known case first, then implement it. Preserve the canonical schema, provenance and revision checks.

For a concrete walkthrough, open `public/fixtures/case9.json` and find a load ID. Find its `p_mw` field and source; then open `src/completion/missing.ts` to see why that input is required. Follow **Solve** from `src/App.tsx` into `runWorkspaceSolve` in `src/useWorkspace.ts`, through `src/solver/client.ts` and the Worker, to `python/solver_adapter.py`. Finally, find the returned ID in `SolutionRun` and `src/exports/tables.ts`. This path explains how one reviewed input becomes a displayed result without losing its identity.

## Run checks

On Windows use `npm.cmd` in place of `npm`, and `.\.venv\Scripts\python.exe` in place of the Python path below.

```sh
npm run lint
npm run typecheck
npm test
.venv/bin/python -m pytest tests/python
npm run provision:runtime
npm run test:runtime
.venv/bin/python tests/python/verify_runtime_raw.py
npm run build
npm run preview
```

| Check | What it establishes |
| --- | --- |
| Lint / type-check | Code conventions and TypeScript consistency |
| Vitest | Model boundaries, rules, operator races, ingestion/extraction logic, browser adapter behavior and export shaping |
| Native pytest | Actual pandapower conversion/solve, diagnostics and numerical export checks |
| Runtime proof | Real Pyodide/pandapower parity against committed native references, with network blocked during the test |
| Runtime RAW verification | Independent parsing of actual WebAssembly-generated RAW files followed by a native re-solve |
| Browser interaction | Rendering, Worker loading, keyboard/pointer flows and action-to-redraw timing in the actual browser |

`npm test -- tests/operations.test.ts` and `.venv/bin/python -m pytest tests/python/test_adapter.py` are useful focused commands. The RAW verifier requires files created by the immediately preceding runtime proof. Re-run `provision:runtime` after changing `python/solver_adapter.py` or `python/exporters.py`; otherwise the browser uses the preceding copied adapter. Reference fixtures are reviewed test inputs: do not regenerate them to make a failing comparison pass. `npm run format` formats source using the pinned Prettier version; review that diff independently from a functional change.

## Keep source and generated files separate

`src/`, `python/`, `schema/`, `scripts/`, tests, docs and lockfiles are source. `node_modules/`, `.venv/`, `public/runtime/`, `dist/` and most `test-results/` contents are generated. A clean shared folder may omit these generated directories; the setup commands recreate them. `dist/` is the production site output, not the folder to edit.

The browser stores the open case and source blobs in local IndexedDB. Download canonical JSON to keep a portable case; source drawing bytes are not embedded in that JSON. Clearing site data removes the local drawing store. Put any private development drawings in the ignored `private/` directory. Never place an API key in source, JSON, lockfiles or screenshots.

If the engine cannot load, confirm that `public/runtime/runtime-manifest.json` exists, rerun provisioning, then reload the page. If a solve is blocked, read **Validate** and **Complete data**, confirm the exact revised model, and solve again. If an export warns about a reduced or unsupported representation, keep the canonical JSON alongside it and read [the format contract](python/EXPORTS.md).
