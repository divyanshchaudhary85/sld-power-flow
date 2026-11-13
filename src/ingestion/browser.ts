import type { Box, SourcePage, TextSpan } from "../model/types";
import type {
  IngestedDocument,
  IngestedPage,
  IngestedTile,
  IngestionOptions,
  Matrix,
} from "./types";
import {
  clampBox,
  denormalizeBox,
  detectTextRegions,
  invertMatrix,
  normalizeBox,
  tileBoxes,
  transformBox,
} from "./geometry";
import { estimateDeskew } from "./deskew";

export const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw new DOMException("Drawing processing cancelled.", "AbortError");
};
const context2d = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context)
    throw new Error("A two-dimensional canvas is required to read drawings.");
  return context;
};
function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement("canvas");
  result.width = Math.max(1, Math.ceil(width));
  result.height = Math.max(1, Math.ceil(height));
  return result;
}
export const canvasBlob = (source: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    source.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The browser could not encode this drawing.")),
      "image/png",
    ),
  );

export function detectMediaType(
  bytes: Uint8Array,
): "application/pdf" | "image/png" | "image/jpeg" | "image/tiff" {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    (bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      bytes[2] === 42 &&
      bytes[3] === 0) ||
    (bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      bytes[2] === 0 &&
      bytes[3] === 42)
  )
    return "image/tiff";
  if (
    new TextDecoder("ascii").decode(bytes.subarray(0, 1024)).includes("%PDF-")
  )
    return "application/pdf";
  throw new Error(
    "Choose a PDF, PNG, JPEG or standard TIFF drawing. This file signature is not supported (including BigTIFF).",
  );
}

export async function ingestFile(
  file: File,
  options: IngestionOptions = {},
): Promise<IngestedDocument> {
  checkAbort(options.signal);
  if (!file.size || file.size > (options.maxFileBytes ?? 100 * 1024 * 1024))
    throw new Error(
      "Choose a non-empty drawing no larger than 100 MB, or raise the configured file limit.",
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const media = detectMediaType(bytes);
  const fileId = crypto.randomUUID();
  const sha = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(sha), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  const dpi = options.dpi ?? 300;
  if (dpi < 300 || dpi > 600)
    throw new Error("PDF rasterization must be between 300 and 600 DPI.");
  const pages: IngestedPage[] = [],
    warnings: string[] = [];
  const maxPages = options.maxPages ?? 30,
    maxPixels = options.maxPixelsPerPage ?? 80_000_000;
  if (
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    !Number.isFinite(maxPixels) ||
    maxPixels <= 0
  )
    throw new Error("Invalid page or image dimension limit.");
  const sizeCheck = (width: number, height: number) => {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > maxPixels
    )
      throw new Error(
        `This page exceeds the configured ${Math.round(maxPixels / 1e6)} megapixel limit at the requested resolution. Crop the source drawing before importing it.`,
      );
  };
  const finish = async (
    source: HTMLCanvasElement,
    metadata: SourcePage,
    total: number,
    exactScale?: { x: number; y: number },
  ) => {
    checkAbort(options.signal);
    options.onProgress?.({
      stage: "deskewing",
      message: `Checking page ${metadata.page} orientation`,
      page: metadata.page,
      pages: total,
    });
    let angle = options.manualRotationDegree ?? 0,
      confidence = 1;
    let method: IngestedPage["deskew"]["method"] =
      options.manualRotationDegree !== undefined ? "manual" : "none";
    if (
      options.manualRotationDegree === undefined &&
      options.deskew !== false &&
      !metadata.text_spans.length
    ) {
      const scale = Math.min(1, 800 / Math.max(source.width, source.height));
      const thumbnail = canvas(source.width * scale, source.height * scale),
        ctx = context2d(thumbnail);
      ctx.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
      const estimate = estimateDeskew(
        ctx.getImageData(0, 0, thumbnail.width, thumbnail.height).data,
        thumbnail.width,
        thumbnail.height,
      );
      angle = estimate.correctionDegree;
      confidence = estimate.confidence;
      method = angle ? "estimated" : "none";
    }
    if (!Number.isFinite(angle) || Math.abs(angle) > 180)
      throw new Error("Manual rotation must be between -180 and 180 degrees.");
    const radians = (angle * Math.PI) / 180,
      cos = Math.cos(radians),
      sin = Math.sin(radians);
    const rotatedBounds = transformBox(
      { x_min: 0, y_min: 0, x_max: source.width, y_max: source.height },
      [cos, sin, -sin, cos, 0, 0],
    );
    const corrected = canvas(
      rotatedBounds.x_max - rotatedBounds.x_min,
      rotatedBounds.y_max - rotatedBounds.y_min,
    );
    sizeCheck(corrected.width, corrected.height);
    const ctx = context2d(corrected);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, corrected.width, corrected.height);
    ctx.setTransform(
      cos,
      sin,
      -sin,
      cos,
      -rotatedBounds.x_min,
      -rotatedBounds.y_min,
    );
    ctx.drawImage(source, 0, 0);
    const scaleX = exactScale?.x ?? source.width / metadata.original_width,
      scaleY = exactScale?.y ?? source.height / metadata.original_height;
    metadata.deskew_transform = [
      cos * scaleX,
      sin * scaleX,
      -sin * scaleY,
      cos * scaleY,
      -rotatedBounds.x_min,
      -rotatedBounds.y_min,
    ];
    metadata.raster_width = corrected.width;
    metadata.raster_height = corrected.height;
    metadata.rotation_degree = angle;
    const inverse = invertMatrix(metadata.deskew_transform as Matrix);
    const tiles: IngestedTile[] = [];
    options.onProgress?.({
      stage: "tiling",
      message: `Preparing overlapping tiles for page ${metadata.page}`,
      page: metadata.page,
      pages: total,
    });
    for (const box of tileBoxes(
      corrected.width,
      corrected.height,
      options.tileSize ?? 1280,
      options.overlap ?? 0.2,
    )) {
      checkAbort(options.signal);
      const crop = canvas(box.x_max - box.x_min, box.y_max - box.y_min);
      context2d(crop).drawImage(
        corrected,
        box.x_min,
        box.y_min,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );
      const tile = {
        id: `${fileId}-p${metadata.page}-t${tiles.length + 1}`,
        bbox: normalizeBox(
          clampBox(
            transformBox(box, inverse),
            metadata.original_width,
            metadata.original_height,
          ),
          metadata.original_width,
          metadata.original_height,
        ),
        raster_width: crop.width,
        raster_height: crop.height,
        overlap_fraction: options.overlap ?? 0.2,
        scale: 1,
        status: "queued" as const,
        extraction_run_id: null,
      };
      tiles.push({
        metadata: tile,
        rasterBox: box,
        blob: await canvasBlob(crop),
      });
      crop.width = 1;
      crop.height = 1;
    }
    metadata.tiles = tiles.map((tile) => tile.metadata);
    pages.push({
      metadata,
      raster: await canvasBlob(corrected),
      tiles,
      deskew: { method, correctionDegree: angle, confidence },
    });
    source.width = corrected.width = 1;
    source.height = corrected.height = 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  const metadata = (
    page: number,
    width: number,
    height: number,
    unit: "pt" | "px",
    resolution: number,
    text: TextSpan[] = [],
  ): SourcePage => ({
    page,
    original_width: width,
    original_height: height,
    original_unit: unit,
    raster_width: width,
    raster_height: height,
    raster_dpi: resolution,
    rotation_degree: 0,
    deskew_transform: [1, 0, 0, 1, 0, 0],
    text_spans: text,
    tiles: [],
    ...detectTextRegions(text, width, height),
  });
  options.onProgress?.({
    stage: "reading",
    message: `Reading ${file.name}`,
    page: 0,
    pages: 0,
  });
  if (media === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    const workerURL = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerURL.default;
    const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.origin)
      .href;
    const loading = pdfjs.getDocument({
      data: bytes,
      cMapUrl: `${assets}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assets}standard_fonts/`,
      wasmUrl: `${assets}wasm/`,
    });
    const abortLoading = () => {
      void loading.destroy();
    };
    options.signal?.addEventListener("abort", abortLoading, { once: true });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > maxPages)
        throw new Error(
          `This PDF exceeds the configured ${maxPages}-page limit.`,
        );
      for (let p = 1; p <= pdf.numPages; p++) {
        checkAbort(options.signal);
        options.onProgress?.({
          stage: "rasterizing",
          message: `Rasterizing page ${p} at ${dpi} DPI`,
          page: p,
          pages: pdf.numPages,
        });
        const page = await pdf.getPage(p),
          original = page.getViewport({ scale: 1 }),
          view = page.getViewport({ scale: dpi / 72 });
        sizeCheck(view.width, view.height);
        const content = await page.getTextContent(),
          text: TextSpan[] = [];
        for (const item of content.items)
          if ("str" in item && item.str.trim()) {
            const tx = pdfjs.Util.transform(original.transform, item.transform);
            const length = Math.hypot(tx[0], tx[1]) || 1,
              vertical = Math.hypot(tx[2], tx[3]) || 1;
            const w = Math.max(item.width * original.userUnit, 0.1),
              h = Math.max(item.height * original.userUnit, vertical, 0.1);
            const box = transformBox(
              { x_min: 0, y_min: 0, x_max: w, y_max: h },
              [
                tx[0] / length,
                tx[1] / length,
                tx[2] / vertical,
                tx[3] / vertical,
                tx[4],
                tx[5],
              ],
            );
            text.push({
              id: `${fileId}-p${p}-text${text.length + 1}`,
              text: item.str,
              bbox: normalizeBox(
                clampBox(box, original.width, original.height),
                original.width,
                original.height,
              ),
              source: "pdf_text",
            });
          }
        const raster = canvas(view.width, view.height);
        const task = page.render({
          canvas: raster,
          canvasContext: context2d(raster),
          viewport: view,
          background: "#ffffff",
        });
        const cancel = () => task.cancel();
        options.signal?.addEventListener("abort", cancel, { once: true });
        try {
          await task.promise;
        } finally {
          options.signal?.removeEventListener("abort", cancel);
        }
        await finish(
          raster,
          metadata(p, original.width, original.height, "pt", dpi, text),
          pdf.numPages,
          { x: view.width / original.width, y: view.height / original.height },
        );
        page.cleanup();
      }
    } finally {
      options.signal?.removeEventListener("abort", abortLoading);
      await loading.destroy();
    }
  } else if (media === "image/tiff") {
    const { openTiff, tiffOrientation } = await import("./tiff");
    const frames = openTiff(bytes.buffer as ArrayBuffer, maxPages, maxPixels);
    for (let i = 0; i < frames.pageCount; i++) {
      checkAbort(options.signal);
      const frame = frames.decode(i);
      options.onProgress?.({
        stage: "rasterizing",
        message: `Decoding TIFF page ${i + 1}`,
        page: i + 1,
        pages: frames.pageCount,
      });
      const raw = canvas(frame.width, frame.height);
      context2d(raw).putImageData(
        new ImageData(
          new Uint8ClampedArray(frame.rgba),
          frame.width,
          frame.height,
        ),
        0,
        0,
      );
      const oriented = tiffOrientation(
          frame.width,
          frame.height,
          frame.orientation,
        ),
        raster = canvas(oriented.width, oriented.height),
        ctx = context2d(raster);
      ctx.setTransform(...oriented.matrix);
      ctx.drawImage(raw, 0, 0);
      raw.width = raw.height = 1;
      if (!frame.dpi)
        warnings.push(
          `TIFF page ${i + 1} has no physical resolution tag; original pixels are preserved.`,
        );
      await finish(
        raster,
        metadata(i + 1, oriented.width, oriented.height, "px", frame.dpi),
        frames.pageCount,
      );
    }
  } else {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: media }));
    sizeCheck(bitmap.width, bitmap.height);
    const raster = canvas(bitmap.width, bitmap.height);
    context2d(raster).drawImage(bitmap, 0, 0);
    bitmap.close();
    warnings.push(
      "The image physical DPI is unknown. Original pixels are preserved; no additional scan detail is invented.",
    );
    await finish(raster, metadata(1, raster.width, raster.height, "px", 0), 1);
  }
  return {
    sourceFile: {
      file_id: fileId,
      name: file.name,
      media_type: media,
      sha256: hash,
      byte_size: file.size,
      browser_blob_key: null,
      pages: pages.map((page) => page.metadata),
    },
    pages,
    warnings,
  };
}

/** Crop by normalized original drawing box; original-to-raster transform remains authoritative. */
export async function cropPageRegion(
  page: IngestedPage,
  box: Box,
  id: string,
  scale = 1,
  maxDimension = 2048,
): Promise<IngestedTile> {
  const rasterBox = clampBox(
    transformBox(
      denormalizeBox(
        box,
        page.metadata.original_width,
        page.metadata.original_height,
      ),
      page.metadata.deskew_transform as Matrix,
    ),
    page.metadata.raster_width,
    page.metadata.raster_height,
  );
  const width = rasterBox.x_max - rasterBox.x_min,
    height = rasterBox.y_max - rasterBox.y_min;
  if (width <= 0 || height <= 0)
    throw new Error("Cannot crop an empty source region.");
  const factor = Math.min(scale, maxDimension / Math.max(width, height));
  const target = canvas(width * factor, height * factor),
    image = await createImageBitmap(page.raster);
  context2d(target).drawImage(
    image,
    rasterBox.x_min,
    rasterBox.y_min,
    width,
    height,
    0,
    0,
    target.width,
    target.height,
  );
  image.close();
  return {
    blob: await canvasBlob(target),
    rasterBox,
    metadata: {
      id,
      bbox: box,
      raster_width: target.width,
      raster_height: target.height,
      overlap_fraction: 0,
      scale: factor,
      status: "queued",
      extraction_run_id: null,
    },
  };
}

export async function blobDataURL(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}
