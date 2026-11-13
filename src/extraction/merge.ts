import type { Box, DrawingRef, Point } from "../model/types";
import {
  applyMatrix,
  clampBox,
  invertMatrix,
  iou,
  normalizeBox,
} from "../ingestion/geometry";
import type { Matrix } from "../ingestion/types";
import type {
  LocatedComponent,
  LocatedTileResponse,
  MergeGroup,
  NormalizedBox,
} from "./types";

export function originalPoint(
  source: LocatedTileResponse,
  point: [number, number],
): Point {
  const box = source.tile.rasterBox;
  const p = applyMatrix(
    invertMatrix(source.page.metadata.deskew_transform as Matrix),
    {
      x: box.x_min + point[0] * (box.x_max - box.x_min),
      y: box.y_min + point[1] * (box.y_max - box.y_min),
    },
  );
  return {
    x: Math.max(0, Math.min(source.page.metadata.original_width, p.x)),
    y: Math.max(0, Math.min(source.page.metadata.original_height, p.y)),
  };
}
export function originalBox(
  source: LocatedTileResponse,
  box: NormalizedBox,
): Box {
  const corners = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[2], box[3]],
    [box[0], box[3]],
  ] as [number, number][];
  const points = corners.map((point) => originalPoint(source, point));
  return clampBox(
    {
      x_min: Math.min(...points.map((p) => p.x)),
      y_min: Math.min(...points.map((p) => p.y)),
      x_max: Math.max(...points.map((p) => p.x)),
      y_max: Math.max(...points.map((p) => p.y)),
    },
    source.page.metadata.original_width,
    source.page.metadata.original_height,
  );
}
export function drawingRef(
  fileId: string,
  source: LocatedTileResponse,
  bbox: Box,
): DrawingRef {
  const normalized = normalizeBox(
    bbox,
    source.page.metadata.original_width,
    source.page.metadata.original_height,
  );
  return {
    file_id: fileId,
    page: source.page.metadata.page,
    bbox: normalized,
    text_span_ids: source.page.metadata.text_spans
      .filter((span) => iou(span.bbox, normalized) > 0)
      .map((span) => span.id),
  };
}
export function locateComponents(
  sources: LocatedTileResponse[],
): LocatedComponent[] {
  return sources.flatMap((source) =>
    source.result.components.map((read) => ({
      id: `${source.tile.metadata.id}/component/${read.id}`,
      localId: read.id,
      tileId: source.tile.metadata.id,
      page: source.page.metadata.page,
      type: read.type,
      label: read.label,
      bbox: originalBox(source, read.bbox),
      confidence: read.confidence,
      source,
      read,
      terminals: read.terminals.map((t) => ({
        ...t,
        point: originalPoint(source, t.point),
      })),
    })),
  );
}
export class UnionFind {
  private parents = new Map<string, string>();
  find(id: string): string {
    const p = this.parents.get(id);
    if (!p) {
      this.parents.set(id, id);
      return id;
    }
    if (p === id) return id;
    const root = this.find(p);
    this.parents.set(id, root);
    return root;
  }
  join(a: string, b: string): void {
    const ra = this.find(a),
      rb = this.find(b);
    if (ra !== rb) this.parents.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}
/** Complete-link overlap prevents transitive duplicate chains from merging neighboring symbols. */
export function mergeComponents(components: LocatedComponent[]): MergeGroup[] {
  const groups: LocatedComponent[][] = [];
  const compatible = (a: LocatedComponent, b: LocatedComponent) =>
    a.tileId !== b.tileId &&
    a.page === b.page &&
    a.type === b.type &&
    (!a.label ||
      !b.label ||
      a.label.trim().toLowerCase() === b.label.trim().toLowerCase()) &&
    iou(a.bbox, b.bbox) >= 0.45;
  for (const component of [...components].sort(
    (a, b) =>
      a.page - b.page ||
      a.bbox.y_min - b.bbox.y_min ||
      a.bbox.x_min - b.bbox.x_min ||
      a.id.localeCompare(b.id),
  )) {
    const group = groups.find((members) =>
      members.every((member) => compatible(member, component)),
    );
    if (group) group.push(component);
    else groups.push([component]);
  }
  return groups.map((members, index) => ({
    id: `element-${index + 1}`,
    members,
    selected: [...members].sort(
      (a, b) =>
        b.confidence - a.confidence ||
        Number(!!b.source.refinement) - Number(!!a.source.refinement) ||
        a.id.localeCompare(b.id),
    )[0],
  }));
}

export function segmentOverlap(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tolerance: number,
): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy),
    otherLength = Math.hypot(d.x - c.x, d.y - c.y);
  if (length <= tolerance || otherLength <= tolerance) return false;
  if (
    Math.abs(dx * (d.y - c.y) - dy * (d.x - c.x)) / (length * otherLength) >
    0.025
  )
    return false;
  if (
    Math.abs(dx * (c.y - a.y) - dy * (c.x - a.x)) / length > tolerance ||
    Math.abs(dx * (d.y - a.y) - dy * (d.x - a.x)) / length > tolerance
  )
    return false;
  const tc = ((c.x - a.x) * dx + (c.y - a.y) * dy) / length,
    td = ((d.x - a.x) * dx + (d.y - a.y) * dy) / length;
  return (
    Math.min(length, Math.max(tc, td)) - Math.max(0, Math.min(tc, td)) >
    tolerance * 2
  );
}
export function pointInsideSegment(
  p: Point,
  a: Point,
  b: Point,
  tolerance: number,
): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  if (
    !length ||
    Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / length > tolerance
  )
    return false;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length;
  return t > tolerance && t < length - tolerance;
}
