import type { Box, SourceFile, SourcePage, Tile } from "../model/types";

export type Matrix = [number, number, number, number, number, number];
/** metadata.bbox is normalized; rasterBox is internal corrected-raster pixels. */
export interface IngestedTile {
  metadata: Tile;
  blob: Blob;
  rasterBox: Box;
}
export interface IngestedPage {
  metadata: SourcePage;
  raster: Blob;
  tiles: IngestedTile[];
  deskew: {
    method: "manual" | "estimated" | "none";
    correctionDegree: number;
    confidence: number;
  };
}
export interface IngestedDocument {
  sourceFile: SourceFile;
  pages: IngestedPage[];
  warnings: string[];
}
export interface IngestionProgress {
  stage: "reading" | "rasterizing" | "deskewing" | "tiling";
  message: string;
  page: number;
  pages: number;
}
export interface IngestionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: IngestionProgress) => void;
  dpi?: number;
  tileSize?: number;
  overlap?: number;
  deskew?: boolean;
  manualRotationDegree?: number;
  maxPages?: number;
  maxPixelsPerPage?: number;
  maxFileBytes?: number;
}
