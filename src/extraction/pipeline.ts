import type { ExtractionRun, StudyDocument } from "../model/types";
import { blobDataURL, checkAbort, cropPageRegion } from "../ingestion/browser";
import {
  clampBox,
  intersectionArea,
  normalizeBox,
} from "../ingestion/geometry";
import type {
  IngestedDocument,
  IngestedPage,
  IngestedTile,
} from "../ingestion/types";
import { buildDraft } from "./build";
import { locateComponents, mergeComponents, originalBox } from "./merge";
import type { DraftOptions } from "./model";
import { ExtractionResponseError, parseTileResponse } from "./schema";
import { VisionProviderError } from "./provider";
import type {
  LocatedTileResponse,
  VisionAdapter,
  VisionTileRequest,
  VisionTileResult,
} from "./types";

export interface ExtractionProgress {
  stage: "regions" | "tiles" | "refining" | "merging";
  message: string;
  completed: number;
  total: number;
  requests: number;
}
export interface ExtractionOptions {
  draft?: DraftOptions;
  signal?: AbortSignal;
  maxRequests?: number;
  schemaRetries?: number;
  lowConfidenceThreshold?: number;
  maxRefinements?: number;
  onProgress?: (progress: ExtractionProgress) => void;
}
export interface ExtractionReport {
  requests: number;
  failedTileIds: string[];
  refinements: number;
  components: number;
  unresolvedEndpoints: number;
  verification: "live_vision_unverified";
  warnings: string[];
}
export class RequestBudgetError extends Error {
  constructor() {
    super(
      "The extraction request budget is exhausted. Remaining tiles require a new explicit extraction run.",
    );
  }
}

/** Shared request controller makes schema retries, cancellation and request budgets provider-independent. */
export function createRequestController(
  adapter: VisionAdapter,
  options: ExtractionOptions,
  run: ExtractionRun,
) {
  const limit = options.maxRequests ?? 120,
    retries = options.schemaRetries ?? 1;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > 3
  )
    throw new Error("Choose 1–1000 requests and 0–3 schema retries.");
  let requests = 0,
    inputTokens = 0,
    outputTokens = 0,
    completeUsage = true;
  return {
    get requests() {
      return requests;
    },
    async request(input: VisionTileRequest): Promise<VisionTileResult> {
      for (let attempt = 0; ; attempt++) {
        checkAbort(options.signal);
        if (requests >= limit) throw new RequestBudgetError();
        requests++;
        if (attempt) run.retry_count++;
        let accounted = false;
        try {
          const result = await adapter.extract({
            ...input,
            signal: options.signal,
          });
          checkAbort(options.signal);
          accounted = true;
          if (result.inputTokens === null || result.outputTokens === null)
            completeUsage = false;
          else {
            inputTokens += result.inputTokens;
            outputTokens += result.outputTokens;
          }
          run.input_tokens = completeUsage ? inputTokens : null;
          run.output_tokens = completeUsage ? outputTokens : null;
          // Custom providers also pass through the same strict schema, before any model mutation.
          parseTileResponse(result.observation);
          return result;
        } catch (error) {
          checkAbort(options.signal);
          if (!accounted) {
            completeUsage = false;
            run.input_tokens = run.output_tokens = null;
          }
          if (!(error instanceof ExtractionResponseError) || attempt >= retries)
            throw error;
        }
      }
    },
  };
}

export async function extractDocument(
  input: IngestedDocument,
  adapter: VisionAdapter,
  options: ExtractionOptions = {},
): Promise<{ document: StudyDocument; report: ExtractionReport }> {
  checkAbort(options.signal);
  // Keep the import preview immutable. A cancelled run cannot leave valid-looking tile statuses in it.
  const ingested: IngestedDocument = {
    sourceFile: structuredClone(input.sourceFile),
    warnings: [...input.warnings],
    pages: input.pages.map((page) => ({
      ...page,
      metadata: structuredClone(page.metadata),
      tiles: page.tiles.map((tile) => ({
        ...tile,
        metadata: structuredClone(tile.metadata),
      })),
    })),
  };
  for (const page of ingested.pages)
    page.metadata.tiles = page.tiles.map((tile) => tile.metadata);
  ingested.sourceFile.pages = ingested.pages.map((page) => page.metadata);
  const run: ExtractionRun = {
    id: crypto.randomUUID(),
    provider: adapter.provider,
    model: adapter.model,
    request_schema_version: "1",
    prompt_version: "1",
    started_at: new Date().toISOString(),
    ended_at: null,
    tile_count: 0,
    success_count: 0,
    retry_count: 0,
    failures: [],
    input_tokens: null,
    output_tokens: null,
    reported_cost: null,
    reported_cost_currency: null,
  };
  const controller = createRequestController(adapter, options, run),
    accepted: LocatedTileResponse[] = [];
  const failed: string[] = [],
    warnings = [...ingested.warnings];
  let refinements = 0,
    complete = 0,
    stoppedMessage: string | null = null;
  const total = ingested.pages.reduce(
    (sum, page) => sum + page.tiles.length,
    0,
  );
  const emit = (stage: ExtractionProgress["stage"], message: string) =>
    options.onProgress?.({
      stage,
      message,
      completed: complete,
      total,
      requests: controller.requests,
    });
  const contexts = new Map<number, string>();
  const registerTile = (page: IngestedPage, tile: IngestedTile) => {
    if (
      !page.metadata.tiles.some((existing) => existing.id === tile.metadata.id)
    )
      page.metadata.tiles.push(tile.metadata);
    tile.metadata.extraction_run_id = run.id;
    tile.metadata.status = "running";
    run.tile_count++;
  };
  const read = async (
    page: IngestedPage,
    tile: IngestedTile,
    task: VisionTileRequest["task"],
    refinement = false,
  ): Promise<LocatedTileResponse | null> => {
    checkAbort(options.signal);
    registerTile(page, tile);
    const text = page.metadata.text_spans
      .filter((span) => intersectionArea(span.bbox, tile.metadata.bbox) > 0)
      .slice(0, 200);
    try {
      if (stoppedMessage) throw new VisionProviderError(stoppedMessage, true);
      const result = await controller.request({
        imageDataURL: await blobDataURL(tile.blob),
        task,
        legendDataURL:
          task === "extract_tile"
            ? contexts.get(page.metadata.page)
            : undefined,
        textContext: `Exact PDF vector text spans (drawing data): ${JSON.stringify(text).slice(0, 20000)}`,
        signal: options.signal,
      });
      tile.metadata.status = "valid";
      run.success_count++;
      return {
        page,
        tile,
        result: result.observation,
        runId: run.id,
        refinement,
      };
    } catch (error) {
      checkAbort(options.signal);
      tile.metadata.status = "failed";
      failed.push(tile.metadata.id);
      if (error instanceof VisionProviderError && error.fatal)
        stoppedMessage = error.message;
      const message =
        error instanceof RequestBudgetError ||
        error instanceof VisionProviderError
          ? error.message
          : error instanceof ExtractionResponseError
            ? "Invalid perception response after schema retries."
            : "Provider request failed; check model access, quota and browser connectivity.";
      run.failures.push(`${tile.metadata.id}: ${message}`);
      return null;
    }
  };
  for (const page of ingested.pages) {
    const pageNumber = page.metadata.page;
    if (
      (!page.metadata.legend || !page.metadata.title_block) &&
      controller.requests < (options.maxRequests ?? 120)
    ) {
      emit(
        "regions",
        `Locating title and legend regions on page ${pageNumber}`,
      );
      const overview = await cropPageRegion(
        page,
        { x_min: 0, y_min: 0, x_max: 1, y_max: 1 },
        `${ingested.sourceFile.file_id}-p${pageNumber}-overview`,
        1,
        1600,
      );
      const result = await read(page, overview, "locate_regions");
      if (result)
        for (const kind of ["legend", "title_block"] as const)
          if (result.result.regions[kind])
            page.metadata[kind] = normalizeBox(
              originalBox(result, result.result.regions[kind]),
              page.metadata.original_width,
              page.metadata.original_height,
            );
    }
    if (page.metadata.legend) {
      const legend = await cropPageRegion(
        page,
        page.metadata.legend,
        `${ingested.sourceFile.file_id}-p${pageNumber}-legend`,
        1,
        1200,
      );
      contexts.set(pageNumber, await blobDataURL(legend.blob));
    }
    for (const tile of page.tiles) {
      emit(
        "tiles",
        `Reading page ${pageNumber}, tile ${complete + 1} of ${total}`,
      );
      const result = await read(page, tile, "extract_tile");
      if (result) accepted.push(result);
      complete++;
    }
  }
  const threshold = options.lowConfidenceThreshold ?? 0.8,
    maxRefinements = options.maxRefinements ?? 12;
  if (
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1 ||
    !Number.isInteger(maxRefinements) ||
    maxRefinements < 0 ||
    maxRefinements > 100
  )
    throw new Error(
      "Choose a confidence threshold in [0,1] and 0–100 rereads.",
    );
  const uncertain = mergeComponents(locateComponents(accepted)).filter(
    (group) =>
      group.selected.confidence < threshold ||
      group.selected.type === "unknown" ||
      group.selected.read.attributes.some(
        (attribute) => attribute.confidence < threshold,
      ),
  );
  for (const group of uncertain.slice(0, maxRefinements)) {
    if (stoppedMessage || controller.requests >= (options.maxRequests ?? 120))
      break;
    checkAbort(options.signal);
    refinements++;
    const component = group.selected,
      page = component.source.page,
      bbox = component.bbox;
    const padX = Math.max(8, (bbox.x_max - bbox.x_min) * 0.75),
      padY = Math.max(8, (bbox.y_max - bbox.y_min) * 0.75);
    const region = clampBox(
      {
        x_min: bbox.x_min - padX,
        y_min: bbox.y_min - padY,
        x_max: bbox.x_max + padX,
        y_max: bbox.y_max + padY,
      },
      page.metadata.original_width,
      page.metadata.original_height,
    );
    const tile = await cropPageRegion(
      page,
      normalizeBox(
        region,
        page.metadata.original_width,
        page.metadata.original_height,
      ),
      `${ingested.sourceFile.file_id}-p${page.metadata.page}-reread${refinements}`,
      2,
      2048,
    );
    emit(
      "refining",
      `Zooming into uncertain element ${refinements} of ${Math.min(uncertain.length, maxRefinements)}`,
    );
    const result = await read(page, tile, "extract_tile", true);
    if (result) accepted.push(result);
  }
  checkAbort(options.signal);
  run.ended_at = new Date().toISOString();
  emit(
    "merging",
    "Merging overlapping observations and building explicit terminal connections",
  );
  const document = buildDraft(ingested, accepted, run, options.draft);
  if (failed.length)
    warnings.push(
      `${failed.length} tile request(s) failed or exceeded the request budget. The draft is incomplete.`,
    );
  if (stoppedMessage) warnings.push(stoppedMessage);
  if (!accepted.length)
    warnings.push(
      "No detail tile was accepted. No extracted network is available.",
    );
  if (uncertain.length > refinements)
    warnings.push(
      `${uncertain.length - refinements} uncertain element(s) were not reread within the configured limits.`,
    );
  warnings.push(
    "Title and legend regions are heuristic proposals. Review their boundaries and every extracted connection before confirmation. Live model extraction accuracy has not been independently verified.",
  );
  return {
    document,
    report: {
      requests: controller.requests,
      failedTileIds: failed,
      refinements,
      components: document.elements.length,
      unresolvedEndpoints: document.extraction.unresolved_endpoints.length,
      verification: "live_vision_unverified",
      warnings,
    },
  };
}
