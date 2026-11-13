# Validation, topology and explicit data completion

The deterministic engine in `src/validation` implements the complete PDF section 6 catalog. Each rule is a pure function over the canonical document. `validateNetwork(document)` returns canonical `Finding[]`; it never mutates inputs, changes a default, performs a load flow or treats a mesh as an error.

The unit suite calls each of the 24 rules on a clean control and a deliberately broken variant. Integration checks cover the IEEE 9-bus mesh, authorized isolation, missing versus optional parameters, stale result exclusion and explicit default/type acceptance. Related findings can coexist in a real broken document: for example, an absent source can also leave an island without a reference.

## Rule catalog

| ID | Check | Severity / solve behavior |
| --- | --- | --- |
| D01 | Unknown symbol or unreadable label | Warning |
| D02 | Duplicate equipment ID | Blocking error |
| D03 | Unresolved drawing line endpoint | Blocking error |
| D04 | Unassociated drawing text | Info |
| D05 | Unreviewed low-confidence drawing attribute | Warning |
| T01 | No active grid/synchronous source | Blocking error |
| T02 | Island without a confirmed slack source | Blocking error; explicitly authorized outage remains an error finding but does not block the energized solve |
| T03 | Two-terminal equipment missing a connection | Blocking error |
| T04 | Bus without connected equipment | Warning |
| E01 | Line or closed switch connects different nominal voltages | Blocking error |
| E02 | Transformer winding/bus mismatch or reversed voltage sides | Blocking error |
| E03 | Implausible transformer impedance, power factor, line length or impedance | Warning |
| E04 | Probable V/kV or kVA/MVA unit slip | Warning |
| E05 | Breaker continuous rating below directly connected equipment full-load current | Warning |
| E06 | Connected radial load exceeds its supplying transformer's capacity | Warning |
| E07 | Generator dispatch exceeds nameplate or active-power dispatch limit | Blocking error |
| C01 | Required engineering input or explicit case confirmation missing | Blocking error |
| C02 | Missing/invalid/unconfirmed slack or multiple slack references on one island | Blocking error |
| P01 | Current AC solve did not converge | Error |
| P02 | Current solved bus voltage outside its limits | Alarm |
| P03 | Branch loading above alarm threshold | Alarm |
| P04 | Branch loading above warning threshold but below/equal alarm threshold | Warning |
| P05 | Generator at a reactive limit | Warning |
| P06 | Slack exceeds its rating/import limit or absorbs power when not expected | Warning |

Post-solve findings do not block a subsequent solve. Superseded results do not generate current alarms. Alarm and warning thresholds default to the accepted case settings; bus-specific accepted overrides take precedence. The completion gate requires the primary case thresholds to be explicitly known. `settings.additional_rule_thresholds` supports optional overrides for E03 `max_power_factor`, `min_length_km`, `min_impedance_ohm_per_km`; E04 `max_nominal_kv` and `max_rating_mva`; P06 `rating_multiplier` and `reverse_tolerance_mw`.

E04 is a heuristic, not a unit conversion: its initial absolute plausibility thresholds are 1200 kV and 10000 MVA for transmission, 1000 MVA for industrial systems, or 100 MVA for distribution, and it always asks for verification. It never changes the input. E05 compares a directly attached, unambiguously identified device's nameplate current using `S / (sqrt(3) V)`. E06 sums downstream P and Q only where cutting the transformer separates its LV side from its HV side. Parallel or meshed supply is not arbitrarily assigned to one transformer; actual loading is checked after the AC solve. Unknown nameplate ratings do not become fabricated ratings or block a solve when the numerical model does not require them.

Native library diagnostics use the same finding format. `validateNetwork` retains current `solution.diagnostics` and current `validation.findings` with stage `solver_diagnostic`, deduplicated by ID. Numerical-library diagnostics remain distinct from the pure catalog and preserve their native rule identifiers. The worker/solver integration owns invoking the pinned library diagnostic API.

## Public integration API

| Module / function | Contract |
| --- | --- |
| `validation.validateNetwork(doc)` | Returns all catalog findings plus current native diagnostics |
| `validation.runRule(id, doc)` | Runs one of `RULE_IDS` for focused checks/tests |
| `validation.analyzeTopology(doc, excludedElementIds?)` | Returns reduced nodes, components, connectivity maps, adjacency and energized/de-energized ID arrays |
| `validation.reachableNodes(adjacency, start, excludedElementId?)` | Returns a deterministic set of reachable reduced node IDs |
| `completion.listMissingData(doc)` | Returns `{path, elementId, attribute, label, kind, unit, reason}[]` |
| `completion.suggestedDefaults(doc)` | Returns offered `DataSuggestion[]`; does not install or accept them |
| `completion.acceptSuggestion(doc, suggestion, at?)` | Accepts a still-missing field on a cloned revision with versioned default/library provenance |
| `completion.STANDARD_TYPES` | Small, explicit library of verified pandapower 3.3.3 cable/line/transformer types |
| `completion.applyStandardType(doc, elementId, typeId, at?)` | Explicitly applies the selected type's displayed fields and provenance |
| `model.userValue(value, at?, evidence?)` | Creates an accepted user input field |
| `model.updateInput(doc, pointer, value, at?)` | Replaces an existing input field, preserving the canonical schema |
| `model.editElementData(doc, id, patch, at?)` | Updates several equipment data fields as one revision |
| `model.editMeta(doc, patch, at?)` | Updates editable case metadata as one revision |
| `model.reconnectTerminal(doc, id, role, pointIdOrNull, at?)` | Connects a terminal or marks it explicitly missing |
| `model.removeElement(doc, id, at?)` | Removes equipment, clears affected source selection and invalidates array-index suggestions |
| `model.assumptionsRegister(doc)` | Returns every accepted current non-drawing field, including user, library and default inputs |

`analyzeTopology` exposes `energizedElementIds`, `deenergizedElementIds`, `energizedPointIds`, `deenergizedPointIds`, `nodes`, `components`, `pointToNode`, `terminalNodes` and `adjacency`. Nodes contain original point IDs, busbar IDs and nominal-voltage evidence. Conflicting values are retained, not averaged. Closed in-service ideal switches are reduced; lines and transformers remain branches. Static generators do not establish a reference island.

An intentional outage must have a real authorizing event ID present in `operation.events`, policy mode `intentional_outage`, and all isolated active equipment covered by `authorized_isolated_element_ids`. The diagram may use topology arrays for styling; it must use actual `SolutionRun` numbers for electrical results. No reachability calculation fabricates a voltage or current.

All editing/completion functions return a new revision, invalidate review/validation and supersede retained results. Operator actions should log their explicit confirmation, authorize intentional outages, then use `confirmReview` to stamp the resulting operation before solving. A normal data correction remains pending review.

## Library and default provenance

The five bundled standard types were read from installed `pandapower==3.3.3` basic standard-type data. Only the listed nameplate parameters are supplied. Line length, unknown operating inputs and thermal derating remain separately visible. Line susceptance is converted deterministically from the library capacitance and selected frequency; changing that frequency through the editing API invalidates the derived value, requiring explicit reconversion. Transformer tap position is deliberately left missing after applying its nameplate type: neutral position is not assumed to be the operating position.

Default offers are limited to declared study options and explicitly labelled modeling simplifications. Loads, generator dispatch, unknown voltage levels and unknown series impedances are never guessed. Offered/rejected suggestions do not enter the assumptions register. Accepted fields retain their source ID, version, timestamp and rationale.

## Demo and verification boundaries

Load a bundled reference, validate it, remove one required impedance value, and observe C01 plus the completion row. Accept a displayed default only where appropriate, or enter the actual value. Open a breaker with explicit confirmation and inspect the T02 outage finding and dimmed section; restore the switch and re-solve. Change a solved load or limit and verify the old result is no longer treated as current.

The pure rule and completion tests are automated. The interactive operator flow, native diagnostic invocation and deployed browser acceptance are recorded by the overall release workflow. This phase does not claim extraction accuracy on real drawings.
