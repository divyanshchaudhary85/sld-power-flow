# Browser solver runtime

The solver runs inside a dedicated Web Worker. It does not send a case to a
server. The production page fetches Python, numerical packages, pure Python
wheels, and the adapter from its own `runtime/` directory. All download URLs in
`runtime-lock.json` are **build-time** sources, not browser endpoints.

## Reproduce the runtime

Run `npm run provision:runtime` from the repository. The script locates the
repository from its own path and also works when invoked from another working
directory. Node 22.12+ and Python 3 are needed. Set `PYTHON` if the Python
executable has a different name. It reads the committed lock, checks SHA-256 for
every existing or downloaded asset, and copies `python/solver_adapter.py` into
the runtime with its own hash. Binary assets remain git-ignored. CI provisions
the same files before building the site.

`public/runtime/runtime-manifest.json` includes the lock digest, adapter hash,
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

The canonical input is cloned before a request leaves the UI. The Worker
independently recomputes the input hash, and includes it and the revision in its
response. The UI adapter rejects superseded responses. The application must
still call `attachSolution(currentDocument, run)` so a result cannot attach to a
case edited while the Worker was running.

Cancellation terminates the Worker, including synchronous Python work; this
does not require `SharedArrayBuffer` or cross-origin isolation headers. The next
solve reloads Python. Ordinary invalidation discards pending results while
retaining the warm Worker.

## Proofs

`npm run test:runtime` initializes the real runtime under Node, blocks network
fetch, and solves the canonical IEEE 9-bus and 14-bus cases. It compares every
bus voltage to separately generated native pandapower references at a 1e-6 pu
tolerance and writes `test-results/runtime-proof.json`.

This is not a substitute for the deployed-browser proof. The Phase 1 release
also requires loading and solving both samples through the actual browser
Worker, plus the separately user-operated vision API proof. The 50-bus
re-solve-and-redraw target is a later console acceptance test; no result from
the small fixtures establishes that target.
