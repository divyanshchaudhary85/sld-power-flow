# Phase 1 foundations and proofs

The user approved the Phase 0 plan and both interpretations on 13 November 2026: secondary per-unit bus-voltage display, and explicitly scoped energized-network solves after intentional isolation. Repository: `divyanshchaudhary85/sld-power-flow`, public, MIT. Initial extraction tests use synthetic drawings; real-world accuracy remains unverified.

## Implemented

- Full canonical schema/types, strict structure/reference checks, finite-JSON checks, review fingerprint and stale-result guards.
- Native pandapower adapter with explicit switch reduction, supported fixed taps, source/load/shunt results, intentional outage reporting and nonconvergence handling.
- IEEE 9/14-bus canonical samples and independently executed native reference solutions.
- Self-hosted Pyodide 0.29.3 and pandapower 3.3.3, pinned numerical dependency closure, SHA-256 asset verification and licence notices.
- Responsive worker initialization, stage progress, cancellation and retry.
- Dark/light proof workspace, live bus/branch/source results, native-reference comparison, canonical save/import and review confirmation.
- Direct OpenAI image/structured-output proof with user-entered model and memory-only key, explicit consent, cancellation and schema checks.
- GitHub Actions checks and a main-only GitHub Pages deployment after verification.

## Measured local evidence

| Check                                        | Result                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| TypeScript and production build              | Passed                                                     |
| ESLint                                       | Passed                                                     |
| Frontend/model/worker tests                  | 31 passed                                                  |
| Native Python adapter tests                  | 14 passed                                                  |
| Native IEEE 9 canonical round trip           | Maximum bus voltage difference `3.3306690738754696e-16 pu` |
| Native IEEE 14 canonical round trip          | Maximum bus voltage difference `0.0 pu`                    |
| Pyodide IEEE 9 vs native                     | Maximum difference `6.661338147750939e-16 pu`              |
| Pyodide IEEE 14 vs native                    | Maximum difference `6.661338147750939e-16 pu`              |
| Network-disabled Node/Pyodide initialization | 15.45 s in the final recorded run                          |
| Warm Node/Pyodide solve request              | 0.721 s (9-bus), 0.819 s (14-bus)                          |
| CI workflow syntax/actionlint                | Passed                                                     |

Timing figures describe one measured local run, not a performance guarantee. The Phase 3 target includes a 50-bus solve and redraw and is not established here. Runtime evidence is generated in `test-results/runtime-proof.json`; CI retains it as an artifact. Four upstream case14 tap-metadata deprecation warnings do not change the passing numerical comparisons.

The native/Node checks do not substitute for the deployed browser proofs. Live-browser results and the visitor-key proof must be recorded below before tagging Phase 1 as passed.

## Live acceptance status

- GitHub Pages deployment: passed. [Verify/build and deploy run](https://github.com/divyanshchaudhary85/sld-power-flow/actions/runs/43409058002), source commit `06a40f8220362a0668110fbb7c3159a7323edce5`.
- Deployed browser IEEE 9/14 proof: passed in Chrome on 13 November 2026. Both converged in 3 iterations and displayed maximum all-bus voltage error `6.66e-16 pu`, below `1e-6 pu`. First runtime initialization: 20.11 s. Request-to-result: 0.746 s (9-bus), 0.651 s (14-bus). These are individual observations, not a performance guarantee.
- Deployed direct-browser OpenAI image response: pending user key test.
- Phase 1 tag: not created; acceptance is incomplete.

Screenshots: [IEEE 9 in dark theme](images/phase-1-live-case9.jpg), [IEEE 14 in light theme](images/phase-1-live-case14.jpg). Neither screenshot contains a key or a private case. The browser import interaction could not be verified because the Chrome extension lacks local-file URL access; no extension permissions were changed. Structural import/review behavior is covered by model tests; the full browser file-picker path remains unverified.

## Demo script

Open the deployed URL in a fresh browser window; observe named runtime-loading stages while navigating between panels. Select IEEE 9-bus and solve; inspect the actual bus values and all-bus reference comparison. Repeat with IEEE 14-bus. Save/reopen a canonical case; confirm it cannot solve until the imported inputs are reviewed. Switch between themes. Open Vision connection, enter a model ID and visitor key, consent to the synthetic tile and run the request; save the receipt without the key. Clear the key or leave the panel.

## Deliberately unfinished

The full engineering rule catalog and native diagnostic mapping, interactive one-line console, switch/setpoint controls, standard-type completion, XLSX/CSV/PDF/MATPOWER/RAW exports, actual document ingestion/extraction/review and measured extraction accuracy belong to subsequent phases. Invalid or unsupported cases produce errors; those features are not represented by stubs that pretend to work.

One dependency change from the proposal: TypeScript 7.0.2 conflicts with the selected typescript-eslint peer range. TypeScript 5.9.3 was installed instead, without overriding peer dependency checks. Later-phase UI/export libraries are intentionally not installed until their phase uses them.
