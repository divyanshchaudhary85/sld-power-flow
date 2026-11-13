# Browser solver runtime

The solver runs inside a dedicated Web Worker. It does not send a case to a
server. The production page fetches Python, numerical packages, pure Python
wheels, and the adapter from its own `runtime/` directory. All download URLs in
`runtime-lock.json` are **build-time** sources, not browser endpoints.

## Reproduce the runtime

Run `npm run provision:runtime` from the repository. The script locates the
repository from its own path and also works when invoked from another working
directory. Use the CI versions Node 22.17.1 and Python 3.13.5. Set `PYTHON` if the Python
executable has a different name. It reads the committed lock, checks SHA-256 for
every existing or downloaded asset, and copies `python/solver_adapter.py` and
`python/exporters.py` into the runtime with their own hashes. Re-provision after
changing either module. Binary assets remain git-ignored. CI provisions
the same files before building the site.

`public/runtime/runtime-manifest.json` includes the lock digest, adapter/exporter hashes,
wheel hashes and versions, and payload size. `THIRD_PARTY_NOTICES.txt` is
generated from the exact wheel distributions plus pinned upstream licence
texts. Package licence identifiers are summaries; the accompanying notices
include third-party components bundled inside the distributions.

## Installation and execution

Pyodide 0.29.3 loads its numerical package closure from the self-hosted upstream
package lock. The upstream lock's `info.version` is historical information;
Pyodide checks its ABI identifier separately. Pure Python wheels are installed
with Pyodide's documented `unpackArchive(..., 'wheel')` API. The bootstrap then
checks their installed versions and every applicable declared dependency using
Python package metadata. There is no runtime pip resolution or package-index
request. Optional pandapower acceleration is disabled by the adapter.

The bootstrap checks wheel and adapter integrity before use. The build checks
the loader, standard library, WASM and all numerical package hashes. Pyodide's
package loader also checks numerical package integrity against its lock.

The canonical input is cloned before a request leaves the UI. Exact review of
the revision and input hash is required in both the browser client and Worker. The Worker
independently recomputes the input hash, and includes it and the revision in its
response. The UI adapter rejects superseded responses. The application must
still calls `attachSolution(currentDocument, run)` so a result cannot attach to a
case edited while the Worker was running. `runWorkspaceSolve` also checks the
current operation generation after each asynchronous preparation, solve, attach
and redraw boundary. A superseded catch/finally cannot overwrite a newer error
or clear a newer busy state.

Cancellation terminates the Worker, including synchronous Python work; this
does not require `SharedArrayBuffer` or cross-origin isolation headers. The next
solve reloads Python. Ordinary invalidation discards pending results while
retaining the warm Worker.

## Proofs

`npm run test:runtime` initializes the real runtime under Node, blocks network
fetch, and solves IEEE 9-bus, IEEE 14-bus, the synthetic 50-bus feeder and the
breaker-isolation fixture. It compares every
bus voltage to separately generated native pandapower references at a 1e-6 pu
tolerance and writes `test-results/runtime-proof.json`. It also exercises native
diagnostics and numerical exports. JSON/MAT files are re-imported and solved in
WebAssembly. Then `python tests/python/verify_runtime_raw.py` independently
parses the emitted RAW files and re-solves them natively; run it after the runtime
proof has written `test-results/runtime-exports/`. See [Phase 4](phase-4.md) for
the measured export evidence and format limits.

This is not a substitute for the deployed-browser proof. The console displays
the action-to-two-animation-frames timing separately from runtime initialization.
Only an actual browser interaction measures the full 50-bus re-solve-and-redraw
target; a Node or native timing cannot establish it. The [release verification
report](release-verification.md) records what was run and its environment.

The separate live-key vision proof was deferred by the user. No runtime parity
test establishes vision API availability, real-drawing extraction accuracy or
successful loading of RAW in actual Siemens PSS/E.
