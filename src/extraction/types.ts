import type { Box, Point } from "../model/types";
import type { IngestedPage, IngestedTile } from "../ingestion/types";

export const ELEMENT_TYPES = [
  "busbar",
  "line",
  "cable",
  "transformer_2w",
  "external_grid",
  "generator",
  "static_generator",
  "load",
  "motor",
  "shunt",
  "circuit_breaker",
  "disconnector",
  "fuse",
  "unknown",
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];
export type NormalizedBox = [number, number, number, number];
export interface ReadAttribute {
  name: string;
  number: number | null;
  text: string | null;
  boolean: boolean | null;
  unit: string;
  raw_text: string;
  confidence: number;
}
export interface ReadTerminal {
  id: string;
  role: "bus" | "from" | "to" | "hv" | "lv" | "a" | "b" | "unknown";
  point: [number, number];
  confidence: number;
}
export interface ReadComponent {
  id: string;
  type: ElementType;
  label: string | null;
  bbox: NormalizedBox;
  confidence: number;
  attributes: ReadAttribute[];
  terminals: ReadTerminal[];
}
export interface ReadEndpoint {
  component_id: string | null;
  terminal_id: string | null;
}
export interface ReadStroke {
  id: string;
  points: [number, number][];
  from: ReadEndpoint;
  to: ReadEndpoint;
  confidence: number;
}
export interface TileResponse {
  components: ReadComponent[];
  strokes: ReadStroke[];
  junctions: {
    id: string;
    point: [number, number];
    stroke_ids: string[];
    confidence: number;
  }[];
  unassociated_text: {
    text: string;
    bbox: NormalizedBox;
    confidence: number;
  }[];
  regions: { legend: NormalizedBox | null; title_block: NormalizedBox | null };
  notes: string[];
}
export interface VisionTileRequest {
  imageDataURL: string;
  legendDataURL?: string;
  textContext: string;
  task: "locate_regions" | "extract_tile";
  signal?: AbortSignal;
}
export interface VisionTileResult {
  observation: TileResponse;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface VisionAdapter {
  provider: string;
  model: string;
  extract(request: VisionTileRequest): Promise<VisionTileResult>;
}
export interface LocatedTileResponse {
  page: IngestedPage;
  tile: IngestedTile;
  result: TileResponse;
  runId: string;
  refinement?: boolean;
}
export interface LocatedComponent {
  id: string;
  localId: string;
  tileId: string;
  page: number;
  type: ElementType;
  label: string | null;
  bbox: Box;
  confidence: number;
  source: LocatedTileResponse;
  read: ReadComponent;
  terminals: {
    id: string;
    role: ReadTerminal["role"];
    point: Point;
    confidence: number;
  }[];
}
export interface MergeGroup {
  id: string;
  members: LocatedComponent[];
  selected: LocatedComponent;
}
