import type { Point, StudyDocument } from "../model";

/** Branch P is positive from this terminal into the branch, at BOTH ends. */
export function flowArrow(
  value: number | null,
  terminal: Point,
  toward: Point,
): string {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 1e-9)
    return "";
  const dx = (toward.x - terminal.x) * Math.sign(value);
  const dy = (toward.y - terminal.y) * Math.sign(value);
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) return "";
  return Math.abs(dx) >= Math.abs(dy)
    ? dx > 0
      ? "→"
      : "←"
    : dy > 0
      ? "↓"
      : "↑";
}

export function defaultDependent(
  doc: StudyDocument,
  resultPath: string,
): boolean {
  const quality = doc.solution?.quality;
  if (!quality) return false;
  const defaults = new Set(quality.defaulted_input_paths);
  return quality.dependencies.some(
    (dependency) =>
      (dependency.result_path === resultPath ||
        resultPath.startsWith(`${dependency.result_path}/`)) &&
      dependency.input_paths.some((path) => defaults.has(path)),
  );
}
