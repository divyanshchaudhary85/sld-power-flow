# Drawing ingestion and extraction

`ingestFile(file, options)` decodes PDF, PNG, JPEG and standard TIFF locally. PDF.js renders at 300 DPI by default (300–600 configurable) and preserves vector text spans. UTIF decodes multipage TIFF, including orientation tags 1–8. Raster images preserve their supplied pixels; unknown physical DPI is reported as zero. BigTIFF and decoder-unsupported compression are rejected. The default limits are 100 MB/file, 30 pages, and 80 megapixels/page.

Scans without PDF vector text receive a deterministic projection-profile deskew search over ±5°. A weak estimate leaves the scan unchanged. `manualRotationDegree` overrides estimation. The first stage finds possible title/legend regions from vector text; an optional vision overview refines them. These boundaries remain review proposals. Detail tiles overlap by 20% and are 1280 pixels by default.

The upload screen offers permission-cleared sample PDF, TIFF and PNG files from `public/drawings/`. They go through the same file-ingestion path as user files and contain no prepared extraction response. The PDF has two 720×504-point pages with vector text (516 and 519 extracted characters). Its 300-DPI raster size is 3000×2100 per page. The LZW TIFF has two 3000×2100 pages with 300-DPI tags; the PNG contains the first page with a 300-DPI tag. The PNG decoder preserves pixels but currently reports physical DPI as unknown. Both PDF pages were rendered with Poppler and visually inspected; the production UTIF adapter decodes both actual TIFF pages in the test suite. The optional `scripts/generate_ingestion_samples.py` recreates them with ReportLab and Pillow. All quantities are fictional and deliberately incomplete; these are ingestion/preview samples, not ready-to-solve cases.

All canonical `Box` fields are normalized to the original displayed page. This includes PDF text spans, tile boxes, title/legend regions and `DrawingRef.bbox`. `SourcePage.deskew_transform` maps original displayed page coordinates (PDF points or image pixels) to the corrected raster, **not** normalized coordinates. Denormalize a box by `original_width`/`original_height`, then transform all four corners. Internal `IngestedTile.rasterBox` is in raster pixels. Element drawing layout and connectivity positions use original displayed page units.

`extractDocument(ingested, adapter, options)` returns `{document, report}`. Its provider-independent adapter accepts one tile, optional legend context and overlapping exact PDF text. `createOpenAIVisionAdapter({apiKey,model})` implements the Responses API with `store:false`, strict JSON Schema, in-memory credentials and no arbitrary endpoint setting. The application requests consent before sending images; only the chosen provider receives tiles/text. Schema validation is repeated for custom adapters. HTTP failures are not blindly retried. Schema failures can retry once by default. Every attempt—including overviews, retries and zoom rereads—counts against `maxRequests` (default 120). Cancellation rejects the run without mutating the imported preview.

The deterministic builder merges only overlapping same-page symbols with consistent type and label, retaining every source reference. Crossings do not connect unless an explicit junction is observed. It joins duplicated collinear wire segments across overlapping tiles, then maps each physical conductor to canonical terminal connection points. Equipment interiors are never collapsed into wires. Unattached wire endpoints remain visible in `extraction.unresolved_endpoints`. Components contained within proposed title/legend regions become annotations. Every extracted case remains pending human review.

Missing electrical values stay missing. Literal unit conversions are recorded as derivations, and unitless physical quantities are not assigned guessed units. Conflicting reads remain ambiguous even when one confidence is higher. A printed type name alone does not establish a versioned equipment-library reference. `createDraft` and `createElement` also begin with explicit missing electrical data. Suggested study settings are offered for user acceptance.

## Evaluating a real extraction

Use a permission-cleared drawing and prepare independent human labels according to `schema/extraction-truth.schema.json`. Labels use normalized original page boxes and all pairwise same-net terminal connections. Download the canonical case immediately after extraction, before edits. Keep private drawings, cases and label files outside Git; the evaluator needs only the case and labels, not the drawing itself or any API key.

```sh
node scripts/evaluate-extraction.mjs --case path/to/unedited-case.json --truth path/to/human-truth.json --out path/to/metrics.json --mode live_vision
```

The command validates both files, performs no network access, and scores component type/location (IoU ≥ 0.5), normalized exact label text, and terminal connectivity independently. It records provider/model run provenance and flags user edits. Precision, recall and F1 are null where a denominator is absent. This is evidence for the supplied test set, not a general model accuracy guarantee; ratings, numerical attributes and engineering suitability require separate human review.

The tests and bundled tiny evaluation fixture use supplied deterministic observations. They test the merge/topology pipeline and metric implementation. They are explicitly **not live vision accuracy measurements**. No permission-cleared real drawing set or live provider results have been supplied, so real-world extraction accuracy remains unmeasured.

Reproduce the bundled metric smoke test with:

```sh
node scripts/evaluate-extraction.mjs --case docs/evaluation/synthetic-case.json --truth docs/evaluation/synthetic-truth.json --out docs/evaluation/synthetic-metrics.json --mode deterministic_fixture
```

The tiny supplied observation fixture scores 2/2 components, 2/2 labels and 1/1 terminal connection. `synthetic-drawing.svg` illustrates that deliberately small topology; its observations are authored test data, not model output. This is a deterministic test, not an extraction accuracy benchmark. To regenerate its canonical/label JSON from the tested builder, run the extraction test with `WRITE_EVALUATION_FIXTURE=1` in the environment.

Primary implementation references: [PDF.js rendering examples](https://mozilla.github.io/pdf.js/examples/), [UTIF API](https://github.com/photopea/UTIF.js), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
