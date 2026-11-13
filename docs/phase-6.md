# Phase 6: polish and release implementation

The project includes the finished study panels, dark/light themes, keyboard-operable equipment and table selection, modal focus handling, loading/error/empty states, a local persistence indicator, explicit study-only limitations, and deployment-update recovery. Heavy readers and exporters are lazy loaded. All runtime numerical packages and fonts are self-hosted and integrity checked.

The public repository contains reproducible setup instructions, exact dependency locks, licence manifests, synthetic fixtures, numerical and frontend tests, native/actual-WASM export verification, CI/Pages deployment, an architecture walkthrough and optional VS Code tasks. [START-HERE](../START-HERE.md) provides a learning route that also works in other IDEs.

The user authorized implementing all phases while postponing live API testing. Therefore **implementation completion does not mean every original release acceptance item has passed**. The live-key drawing-to-export check, real labelled extraction accuracy, and actual Siemens PSS/E desktop import remain unverified. See the [release checklist and measured evidence](release-verification.md).

## Demo

Start at the live link, load IEEE 9-bus, solve, inspect the reference match, select a line and simulate a service-state change, reset the base, then open **Export study** and download the complete ZIP. It contains canonical inputs, pandapower JSON, MATPOWER, RAW v33, a spreadsheet, CSV tables and a PDF report. No API key is needed for this sample route.
