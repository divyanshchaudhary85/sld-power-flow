import type { Box, Point, TextSpan } from "../model/types";
import type { Matrix } from "./types";

/** Canonical source boxes are fractions of the original displayed page. */
export const normalizeBox = (box: Box, width: number, height: number): Box => ({
  x_min: box.x_min / width,
  y_min: box.y_min / height,
  x_max: box.x_max / width,
  y_max: box.y_max / height,
});
export const denormalizeBox = (
  box: Box,
  width: number,
  height: number,
): Box => ({
  x_min: box.x_min * width,
  y_min: box.y_min * height,
  x_max: box.x_max * width,
  y_max: box.y_max * height,
});

export const applyMatrix = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
export function invertMatrix(m: Matrix): Matrix {
  const determinant = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(determinant) < 1e-12)
    throw new Error("The drawing coordinate transform is singular.");
  return [
    m[3] / determinant,
    -m[1] / determinant,
    -m[2] / determinant,
    m[0] / determinant,
    (m[2] * m[5] - m[3] * m[4]) / determinant,
    (m[1] * m[4] - m[0] * m[5]) / determinant,
  ];
}
export function transformBox(box: Box, matrix: Matrix): Box {
  const points = [
    { x: box.x_min, y: box.y_min },
    { x: box.x_max, y: box.y_min },
    { x: box.x_max, y: box.y_max },
    { x: box.x_min, y: box.y_max },
  ].map((p) => applyMatrix(matrix, p));
  return {
    x_min: Math.min(...points.map((p) => p.x)),
    y_min: Math.min(...points.map((p) => p.y)),
    x_max: Math.max(...points.map((p) => p.x)),
    y_max: Math.max(...points.map((p) => p.y)),
  };
}
export function clampBox(box: Box, width: number, height: number): Box {
  return {
    x_min: Math.max(0, Math.min(width, box.x_min)),
    x_max: Math.max(0, Math.min(width, box.x_max)),
    y_min: Math.max(0, Math.min(height, box.y_min)),
    y_max: Math.max(0, Math.min(height, box.y_max)),
  };
}
export function intersectionArea(a: Box, b: Box): number {
  return (
    Math.max(0, Math.min(a.x_max, b.x_max) - Math.max(a.x_min, b.x_min)) *
    Math.max(0, Math.min(a.y_max, b.y_max) - Math.max(a.y_min, b.y_min))
  );
}
export function iou(a: Box, b: Box): number {
  const intersection = intersectionArea(a, b);
  const area =
    (a.x_max - a.x_min) * (a.y_max - a.y_min) +
    (b.x_max - b.x_min) * (b.y_max - b.y_min) -
    intersection;
  return area > 0 ? intersection / area : 0;
}
export function tileBoxes(
  width: number,
  height: number,
  size = 1280,
  overlap = 0.2,
): Box[] {
  if (
    ![width, height, size].every((x) => Number.isFinite(x) && x > 0) ||
    overlap < 0.05 ||
    overlap > 0.5
  )
    throw new Error("Invalid image or tiling dimensions.");
  const positions = (length: number) => {
    const result = [0];
    const step = Math.max(1, Math.floor(size * (1 - overlap)));
    while (result[result.length - 1] + size < length)
      result.push(Math.min(length - size, result[result.length - 1] + step));
    return result;
  };
  return positions(height).flatMap((y) =>
    positions(width).map((x) => ({
      x_min: x,
      y_min: y,
      x_max: Math.min(width, x + size),
      y_max: Math.min(height, y + size),
    })),
  );
}
export function detectTextRegions(
  text: TextSpan[],
  width: number,
  height: number,
): { title_block: Box | null; legend: Box | null } {
  const locate = (pattern: RegExp, expandX: number, expandY: number) => {
    const match = text.find((span) => pattern.test(span.text));
    return match
      ? clampBox(
          {
            x_min: match.bbox.x_min - 8 / width,
            y_min: match.bbox.y_min - 8 / height,
            x_max: match.bbox.x_min + expandX,
            y_max: match.bbox.y_min + expandY,
          },
          1,
          1,
        )
      : null;
  };
  return {
    legend: locate(/\b(?:legend|symbol\s+(?:key|list)|symbols)\b/i, 0.36, 0.4),
    title_block: locate(
      /\b(?:drawing\s*(?:no|number)|drawing\s*title|revision|drawn\s+by)\b/i,
      0.38,
      0.22,
    ),
  };
}
