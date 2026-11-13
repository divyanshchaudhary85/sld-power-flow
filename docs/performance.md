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

The substantial saving came from strict schema validation. Its equipment union has fourteen mutually exclusive literal type tags. The fast path validates the whole document envelope and then validates every current and saved-base element against its exact tagged schema. Any failed fast-path check falls back to the original authoritative schema for normal detailed errors. No validation result, hash or topology is cached across documents, mutations or revisions.

The JSON safety scan uses individual own-property descriptors instead of allocating a full descriptor map for every object. It retains the same finite-number, plain-object, accessor, symbol and cycle checks. Canonical serialization and hash bytes are unchanged. Network validation also reuses its already-computed topology for the completeness rule within that single call. That small change does not establish a measurable overall rule-validation speedup in this noisy local sample; no speedup is claimed for it.

For IEEE9, IEEE14, the 50-bus case and the explicit-breaker case, SHA-256 comparison of the complete topology, findings, missing-data list and canonical input hash was identical before and after. Adversarial tests compare the tagged path with the authoritative schema for every equipment type, unknown properties, mismatched types, malformed provenance and saved-base elements. In-place edits are checked afresh.

The pre-optimization browser measurement was 3.837 seconds for the first 50-bus interaction and 2.313 seconds for a repeat, with runtime initialization measured separately. After the initial validation change, the browser measured 2.265 and 2.214 seconds. These observations do not meet the two-second target.

A subsequent profile included the saved base snapshot that the UI carries. Extending exact-tag checks to those elements reduced strict validation from 66.23 to 20.76 ms, and review confirmation from 162.92 to 103.18 ms (30-sample Node medians). The solver adapter now validates the complete incoming case, then removes only saved-base/prior-result/validation/export-history sections from its private worker snapshot. Its electrical input hash and outage event history are unchanged; a test verifies more than 30% less serialized payload on the 50-bus case. The workspace transaction also avoids a duplicate private clone/hash and a successful pre-solve render commit while preserving failure findings and stale-result guards.

Browser timing after these final changes is **unverified**. Node validation savings alone do not prove the browser target. The measured browser results above remain the latest browser evidence.

To reproduce the local profile in PowerShell:

```powershell
$env:PERFORMANCE_PROFILE='current'
node node_modules/vitest/vitest.mjs run tests/performance-profile.test.ts
Remove-Item Env:PERFORMANCE_PROFILE
```

This writes measured samples and semantic checks to `test-results/performance-current.json`. The opt-in profile has no wall-clock pass/fail assertion. The ordinary test suite includes the strict-validation conformance tests.
