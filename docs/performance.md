# Validation performance measurement

The 50-bus reference case contains 149 canonical elements. A Node 22/Vitest profile measured each operation after five warm-ups, using the median of 30 samples. These are local CPU measurements, not browser interaction timings.

| Operation                          | Before median (ms) | After median (ms) |
| ---------------------------------- | -----------------: | ----------------: |
| Strict canonical schema validation |              65.44 |             11.71 |
| JSON safety scan                   |              13.06 |              3.81 |
| Canonical input SHA-256            |              15.81 |             11.06 |
| Review confirmation                |             200.44 |             64.42 |
| Full network rule validation       |               3.83 |              4.45 |
| Structured clone                   |               6.75 |              7.01 |

The substantial saving came from strict schema validation. Its equipment union has fourteen mutually exclusive literal type tags. The fast path validates the whole document envelope and then validates each element against its exact tagged schema. Any failed fast-path check falls back to the original authoritative schema for normal detailed errors. Saved-base elements remain checked by the envelope schema. No validation result, hash or topology is cached across documents, mutations or revisions.

The JSON safety scan uses individual own-property descriptors instead of allocating a full descriptor map for every object. It retains the same finite-number, plain-object, accessor, symbol and cycle checks. Canonical serialization and hash bytes are unchanged. Network validation also reuses its already-computed topology for the completeness rule within that single call. That small change does not establish a measurable overall rule-validation speedup in this noisy local sample; no speedup is claimed for it.

For IEEE9, IEEE14, the 50-bus case and the explicit-breaker case, SHA-256 comparison of the complete topology, findings, missing-data list and canonical input hash was identical before and after. Adversarial tests compare the tagged path with the authoritative schema for every equipment type, unknown properties, mismatched types, malformed provenance and saved-base elements. In-place edits are checked afresh.

The pre-optimization browser measurement was 3.837 seconds for the first 50-bus interaction and 2.313 seconds for a repeat, with runtime initialization measured separately. Browser timing must be remeasured after the optimization; Node validation savings alone do not prove the browser target.

To reproduce the local profile in PowerShell:

```powershell
$env:PERFORMANCE_PROFILE='current'
node node_modules/vitest/vitest.mjs run tests/performance-profile.test.ts
Remove-Item Env:PERFORMANCE_PROFILE
```

This writes measured samples and semantic checks to `test-results/performance-current.json`. The opt-in profile has no wall-clock pass/fail assertion. The ordinary test suite includes the strict-validation conformance tests.
