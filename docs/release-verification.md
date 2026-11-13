# Release verification

This is an implementation release of phases 1–6. The user explicitly authorized continuing all phases and deferred live API testing. Measurements are from 13 November 2026 on the development machine, with Node 22.17.1, Python 3.13.5, Pyodide 0.29.3 and pandapower 3.3.3. The original acceptance checklist is retained below rather than declaring unperformed checks passed.

## Automated evidence

| Check | Result |
| --- | --- |
| Frontend tests | 116 passed; one optional timing profile skipped |
| Native Python tests | 33 passed; six upstream warnings |
| Lint, TypeScript, production build | Passed |
| JavaScript dependency audit | Zero known advisories in installed lock |
| Native dependency pins | 34 exact pins; installed versions match; pip check clean |
| Four native fixture roundtrips | Worst voltage difference 3.34e-16 pu |
| Six native format roundtrips | Worst voltage difference 0 pu |
| Four actual Pyodide solves | Worst voltage difference 6.67e-16 pu |
| Six actual-Pyodide export reimports, including independent RAW reader | Worst voltage difference below 4.77e-10 pu |
| Repository/history source scan | No credentials or real drawings found in scoped source/history scan |

Threshold for numerical parity and export roundtrips is 1e-6 pu. RAW tests use an independent open-source v33 reader and reconstruct a native pandapower case; they do not establish Siemens PSS/E product certification. Per-user-case roundtrip status stays **not run** in exported metadata unless actually measured.

The history audit covered 139 working source files and 69 reachable blobs in six pre-release commits. Later commits add reviewed source, synthetic assets and these reports. A generic `api_key` match was an intentional invalid-schema test, not a credential. Ignored private folders and external credential stores were not scanned.

## Browser evidence

- IEEE 9/14 native parity was previously demonstrated on the live Phase 1 site.
- Local 50-bus solve reproduced all 50 native bus voltages, worst difference 2.23e-16 pu.
- Opening the synthetic load breaker converged and redrew in 1.309 s, reported 225 MW served / 90 MW unserved, and recorded the switch plus solve events.
- Real local PDF/TIFF/PNG ingestion and source-page review passed, without a provider request.
- Pre-optimization 50-bus UI timing: 3.837 s first, 2.313 s repeat. Final optimized measurements are appended after the final browser run.

## Original release checklist

| Requirement | Status |
| --- | --- |
| Live site opens with empty cache/private window | Final deployment check pending |
| Bundled sample loads, solves, switches and exports without a key | Final integrated browser check pending |
| One synthetic drawing goes from live vision upload to export with visitor key | User deferred; unverified |
| Automated checks green on main | Final release run pending |
| Repository history contains no secret or real drawing | Scoped scan passed |

Real-world extraction accuracy is unmeasured. The deterministic evaluator self-test is not an extraction benchmark. Browser performance is machine-dependent; cold runtime initialization is reported separately from solve/redraw time. This tool performs balanced positive-sequence simulated steady-state studies only.
