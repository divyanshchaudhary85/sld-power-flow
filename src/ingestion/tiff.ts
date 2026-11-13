import UTIF from "utif";
import type { Matrix } from "./types";

export interface TiffPage {
  width: number;
  height: number;
  rgba: Uint8Array;
  dpi: number;
  orientation: number;
}
export function openTiff(
  bytes: ArrayBuffer,
  maxPages = 30,
  maxPixels = 80_000_000,
): { pageCount: number; decode(index: number): TiffPage } {
  const frames = UTIF.decode(bytes).filter(
    (frame) => Array.isArray(frame.t256) && Array.isArray(frame.t257),
  );
  if (!frames.length || frames.length > maxPages)
    throw new Error(
      `The TIFF must contain between 1 and ${maxPages} image pages.`,
    );
  return {
    pageCount: frames.length,
    decode(index) {
      const frame = frames[index];
      if (!frame) throw new Error("The TIFF page does not exist.");
      const width = Number((frame.t256 as number[])[0]),
        height = Number((frame.t257 as number[])[0]);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width * height > maxPixels
      )
        throw new Error(
          `TIFF page ${index + 1} exceeds the image dimension limit.`,
        );
      UTIF.decodeImage(bytes, frame, frames);
      if (frame.width !== width || frame.height !== height)
        throw new Error(
          `TIFF page ${index + 1} could not be decoded. Its compression may not be supported.`,
        );
      const rgba = UTIF.toRGBA8(frame);
      delete frame.data;
      if (rgba.length !== width * height * 4)
        throw new Error("The TIFF decoder returned an incomplete page.");
      const resolution = Array.isArray(frame.t282) ? Number(frame.t282[0]) : 0;
      const unit = Array.isArray(frame.t296) ? Number(frame.t296[0]) : 2;
      const orientation = Array.isArray(frame.t274) ? Number(frame.t274[0]) : 1;
      if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8)
        throw new Error(
          `TIFF page ${index + 1} has an unsupported orientation tag.`,
        );
      return {
        width,
        height,
        rgba,
        orientation,
        dpi:
          Number.isFinite(resolution) && resolution > 0 && unit !== 1
            ? unit === 3
              ? resolution * 2.54
              : resolution
            : 0,
      };
    },
  };
}
export function tiffOrientation(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number; matrix: Matrix } {
  const matrices: Matrix[] = [
    [1, 0, 0, 1, 0, 0],
    [-1, 0, 0, 1, width, 0],
    [-1, 0, 0, -1, width, height],
    [1, 0, 0, -1, 0, height],
    [0, 1, 1, 0, 0, 0],
    [0, 1, -1, 0, height, 0],
    [0, -1, -1, 0, height, width],
    [0, -1, 1, 0, 0, width],
  ];
  return {
    width: orientation > 4 ? height : width,
    height: orientation > 4 ? width : height,
    matrix: matrices[orientation - 1],
  };
}
