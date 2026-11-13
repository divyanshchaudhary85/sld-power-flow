# Phase 3: operator console

The console retains the approved dark panel design and adds a light theme, an original IEC/ANSI SVG symbol library, orthogonal connections, pan/zoom/fit, minimap, equipment navigation, a source/inputs/operations/results inspector, sortable searchable tables, and a timestamped event log.

Operations use select-then-confirm dialogs with keyboard focus containment and Escape cancellation. Switching, service status, P/Q setpoints, voltage setpoints and supported fixed tap positions invalidate old numerical results and request a new solve. Base-case capture, comparison and reset preserve explicit input provenance. Unintentionally disconnected inputs block solving; an explicitly confirmed operation may authorize the newly isolated section, retain it in the drawing, and report its unserved demand.

Flow arrows follow the sign at each branch terminal; zero and unavailable flows have no direction. Voltage and loading findings include text/icons, not colour alone. Result dependency records identify which connected component depends on accepted assumptions. Topology styling does not wait for a converged numerical solve.

## Demo

1. Load **Breaker isolation** and solve.
2. Select **Load isolation breaker**, choose **Operate**, then **Select open**.
3. Confirm the simulated operation. The isolated load remains visible; served demand is 225 MW and unserved demand is 90 MW in this fixture.
4. Inspect **Events**, then choose **Reset to base** and re-solve.
5. Load **50-bus study** to inspect the larger case and its reference comparison.

The measured browser switching result was 1.309 seconds including redraw for the breaker operation. Final timings and release limitations are recorded in [release verification](release-verification.md). They are measurements on one machine, not a universal performance guarantee. The [validation profile](performance.md) explains the optimizations and their checks.
