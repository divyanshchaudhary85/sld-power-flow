# Phase 5: ingestion, extraction and review

Implemented local PDF/PNG/JPEG/TIFF ingestion, multipage handling, PDF text-layer coordinates, rasterization at 300 DPI or higher, deskew with recorded transforms, overlapping tiles, and original-page bounding boxes. Image pixels are preserved when physical DPI is unknown; resampling is not presented as recovered detail.

The provider-agnostic vision interface currently has an OpenAI Responses implementation. The user supplies a model ID and a memory-only key, explicitly consents to transmission, and sets a request budget. Structured responses are schema checked; bounded retries/refinements, cancellation, timeouts and fatal-provider-error handling limit work. The model identifies observations; deterministic code normalizes literal engineering labels and constructs connectivity. It does not infer missing electrical quantities or silently approve a case.

Review links original source regions to reconstructed elements. Equipment can be added, removed, retyped or reconnected; fields and provenance are editable. An unresolved endpoint can be explicitly attached to a reviewed electrical net or marked non-electrical with a reason. Review confirmation is tied to the exact input hash.

## Evidence and limits

- Eighteen automated ingestion/extraction tests pass, including production TIFF decoding, merge/topology/coordinate handling, provider failures, request caps and evaluation.
- Browser sample import read a two-page PDF as 12 tiles with 26/27 text spans, a two-page TIFF as 12 tiles, and a PNG as six tiles. Manual review showed the stored original PNG without an API call.
- `public/drawings/` includes fictional PDF/TIFF/PNG practice drawings and SVG renderings of four fixture cases using the app's own symbols.
- The tiny deterministic evaluator self-test finds 2/2 components, 2/2 labels and 1/1 connection. **This is a test of evaluation code, not measured vision accuracy.**
- The user deferred live visitor-key testing. No successful provider extraction or end-to-end vision accuracy is claimed. Real permission-cleared, hand-labelled diagrams have not been supplied, so real-world accuracy remains unverified.

Use [the evaluation guide](extraction.md) to run actual extracted cases against private truth labels. Raw private diagrams and provider results belong in ignored `private/`, never in the public repository.

## Demo without a key

Open **Upload & extract**, read the privacy notice, load **Sample PDF (2 pages)**, and inspect preprocessing details. Select the network/frequency and choose **Build manually from drawing** to enter review. Use a bundled canonical sample for solving and exports; the manual draft intentionally begins empty.
