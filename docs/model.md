# Canonical study document

`schema/study-document.schema.json` is the approved version 1.0.0 contract, expressed as JSON Schema draft 2020-12. `src/model/types.ts` contains the corresponding declarative TypeScript types. Both were extracted from the approved Phase 0 proposal without changing the field contract. `schema/fixture-template.json` is an empty **reference-fixture template**, not an automatically completed engineering case.

All pipeline artifacts belong to one `StudyDocument`. Source file bytes remain in browser storage and are referenced by file ID; the document never contains API credentials. Schema validation rejects undeclared properties, including an accidentally attached API key. This is not a replacement for the release secret scan.

## Inputs and provenance

Every engineering field is either:

- `status: "known"`, a typed `value`, a `provenance` object, and nullable `derivation`; or
- `status: "missing"`, an explicit reason, candidate values, and drawing evidence.

`0`, `false`, unknown, and an explicitly accepted `null` for a not-applicable capability have different meanings. A missing rating is retained as missing even when it is not required for the numerical solve. Schema validation does not fill values or declare a model electrically complete.

The four input sources are `drawing`, `user`, `library`, and `default`. Drawing inputs require confidence and evidence. Library/default inputs require an explicit acceptance timestamp. A data suggestion is not a solver input until accepted. Changes to accepted provenance affect the input fingerprint because they also affect the assumptions register and result-quality markers.

Every canonical element has a known type discriminator. Unrecognized symbols use `UnknownElement`; they are not silently converted into a supported electrical device. A synthetic fixture uses a synthetic `SourceRef`; manually created equipment uses `user_added`. Neither needs a fictional original-drawing bounding box.

## Topology

Equipment terminals reference connectivity points. Breakers, disconnectors and fuses remain explicit two-terminal elements. The solver adapter owns reduction of closed ideal switches to a bus-branch model and must preserve a mapping back to canonical IDs. A direct line-to-bus shortcut must not bypass its breaker.

The runtime boundary currently checks:

- finite, acyclic JSON data without functions, accessors, undefined values, sparse arrays or exotic object instances;
- the complete JSON Schema, including exact object keys, known enum values and timestamp formats;
- duplicate element, point, terminal, source-file, page, tile and selected extraction IDs;
- known terminal/slack/island references, source file/page/text references and extraction references;
- source-box ordering and current/superseded revision consistency.

Missing terminal references are permitted in a draft document. A known reference to an ID that does not exist is a structural import error. Electrical connectivity, source capability, load flow completeness, nameplate plausibility, the 50-bus limit after reduction, and the complete Phase 2 rule catalog remain separate deterministic checks.

The approved isolation policy distinguishes malformed source-less networks from intentional operator outages. `operation.island_policy` records which elements were intentionally isolated, the authorizing events and the source assigned to each energized island. A static generator is not implicitly a grid-forming source. Dead equipment retains an outage finding and unavailable electrical results while the solver processes only eligible energized components.

## Public TypeScript API

Import from `src/model/index.ts`:

| Function | Result |
| --- | --- |
| `validateStudyDocument(input)` | `{ valid: true, document }` or `{ valid: false, issues }`; never substitutes values |
| `assertStudyDocument(input)` | Narrows the value to `StudyDocument` or throws `ModelValidationError` |
| `parseStudyDocument(text)` | Parses and validates imported JSON; errors identify JSON Pointer paths |
| `inspectJsonValue(input)` | Reports values that cannot be represented faithfully as JSON |
| `inspectStructuralReferences(document)` | Checks the structural links of an already schema-valid document |
| `canonicalStringify(value)` | Stable JSON: sorted object keys, preserved array order, finite values only |
| `electricalSnapshot(document)` | Returns the projection used for solving/fingerprinting |
| `computeInputHash(document)` | Promise of a SHA-256 lowercase hexadecimal digest |
| `confirmReview(document, timestamp?)` | Clones and stamps explicit review of the current revision and exact input hash |
| `isReviewCurrent(document)` | Checks review status, revision and input hash before a solve |
| `commitEngineeringEdit(document, edit, timestamp?)` | Returns an edited clone with incremented revision and invalidated downstream state |
| `attachSolution(document, run)` | Returns a cloned document only if the run revision/hash matches current inputs |

Validation issues contain `code`, `path` and a plain-language `message`. These are structural boundary errors, not the `Finding` objects produced by the future engineering rule catalog.

## Fingerprinting and worker contract

The fingerprint covers schema version, network type/frequency/base inputs, all study settings, sorted connectivity-point IDs, sorted equipment electrical inputs, terminal connections and the island policy. It excludes labels, visual layout, source file bytes, review events, UI preferences, previous results and event history. Within included fields, provenance is included.

Use the TypeScript fingerprint at dispatch time. Send `{ document, inputHash, jobId }` to the worker. The Python adapter must return the supplied `inputHash` and the dispatched document revision. It must not calculate a nominally equivalent digest using Python JSON serialization: floating-point number formatting differs between runtimes. Native fixture generation may leave `solution: null`; the browser produces its own fingerprint when dispatching a real solve.

`attachSolution` is the final race check. A worker response from before an edit cannot overwrite the current case even if it finishes later. The caller must also compare job IDs to avoid replacing a newer solve of identical inputs with an older request's progress state.

Review uses the same browser fingerprint. A trusted bundled reference fixture may be explicitly stamped with `confirmReview` after it is validated; a user-imported case must not be silently reviewed. Its user confirmation calls `confirmReview`, and both the dispatch layer and worker check `isReviewCurrent` before solving. A hash emitted by Python's JSON serializer is not accepted as proof of matching browser inputs.

`commitEngineeringEdit` is the correction path: it increments revision, clears validation, makes review pending, and marks a retained result `superseded`. It does not mutate its input. It should not be used for pan/zoom/theme changes. The Phase 3 operator-action path must explicitly preserve previously confirmed topology review where appropriate and write its event before dispatching a new solve.

## Results

Every numeric result is either `{ status: "available", value }` or `{ status: "unavailable", reason }`. Zero is a measured/computed number; an outage, failure or nonconvergence is not zero. Solver identity, version, runtime version, package-lock digest, options, timings, mappings and revision/hash remain attached to each run.

Result-quality dependencies must conservatively include accepted defaults across an electrically coupled energized component. The assumptions register is derived from accepted non-drawing fields, including user and library inputs, rather than from suggestions.

## Validation scope

The model tests exercise real schema compilation, malformed/unknown/nonfinite data, draft fields, duplicate and broken references, fingerprint sensitivity, edit invalidation and stale worker responses. Reference fixtures are also validated by the Phase 1 solver integration tests. These checks establish the data boundary; they do not constitute the Phase 2 engineering rule catalog or prove any electrical answer.

The validator uses the dedicated [Ajv draft 2020-12 entry point](https://ajv.js.org/json-schema.html#draft-2020-12) and explicitly installs the separate format validators, as required by [Ajv v8's API](https://ajv.js.org/v6-to-v8-migration.html).
