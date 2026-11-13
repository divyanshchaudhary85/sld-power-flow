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

| Check | Result |
| --- | --- |
| TypeScript and production build | Passed |
| ESLint | Passed |
| Frontend/model/worker tests | 31 passed |
| Native Python adapter tests | 13 passed |
| Native IEEE 9 canonical round trip | Maximum bus voltage difference `3.3306690738754696e-16 pu` |
| Native IEEE 14 canonical round trip | Maximum bus voltage difference `0.0 pu` |
| Pyodide IEEE 9 vs native | Maximum difference `6.661338147750939e-16 pu` |
| Pyodide IEEE 14 vs native | Maximum difference `6.661338147750939e-16 pu` |
| Network-disabled Node/Pyodide initialization | 19.01 s in the recorded run |
| Warm Node/Pyodide solve request | 0.657 s (9-bus), 1.167 s (14-bus) |
| CI workflow syntax/actionlint | Passed |

Timing figures describe one measured local run, not a performance guarantee. The Phase 3 target includes a 50-bus solve and redraw and is not established here. Runtime evidence is generated in `test-results/runtime-proof.json`; CI retains it as an artifact. Four upstream case14 tap-metadata deprecation warnings do not change the passing numerical comparisons.

The native/Node checks do not substitute for the deployed browser proofs. Live-browser results and the visitor-key proof must be recorded below before tagging Phase 1 as passed.

## Live acceptance status

- GitHub Pages deployment: pending.
- Deployed browser IEEE 9/14 proof: pending.
- Deployed direct-browser OpenAI image response: pending user key test.
- Phase 1 tag: not created; acceptance is incomplete.

## Demo script

Open the deployed URL in a fresh browser window; observe named runtime-loading stages while navigating between panels. Select IEEE 9-bus and solve; inspect the actual bus values and all-bus reference comparison. Repeat with IEEE 14-bus. Save/reopen a canonical case; confirm it cannot solve until the imported inputs are reviewed. Switch between themes. Open Vision connection, enter a model ID and visitor key, consent to the synthetic tile and run the request; save the receipt without the key. Clear the key or leave the panel.

## Deliberately unfinished

The full engineering rule catalog and native diagnostic mapping, interactive one-line console, switch/setpoint controls, standard-type completion, XLSX/CSV/PDF/MATPOWER/RAW exports, actual document ingestion/extraction/review and measured extraction accuracy belong to subsequent phases. Invalid or unsupported cases produce errors; those features are not represented by stubs that pretend to work.

One dependency change from the proposal: TypeScript 7.0.2 conflicts with the selected typescript-eslint peer range. TypeScript 5.9.3 was installed instead, without overriding peer dependency checks. Later-phase UI/export libraries are intentionally not installed until their phase uses them.
