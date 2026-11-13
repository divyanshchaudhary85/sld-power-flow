/** Deterministic projection-profile scan correction; it never infers electrical data. */
export function estimateDeskew(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): { correctionDegree: number; confidence: number } {
  const points: [number, number][] = [];
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / 180_000)));
  for (let y = 0; y < height; y += stride)
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      if (
        rgba[i + 3] > 128 &&
        rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722 < 115
      )
        points.push([x - width / 2, y - height / 2]);
    }
  if (
    points.length < 80 ||
    points.length > (width * height * 0.55) / (stride * stride)
  )
    return { correctionDegree: 0, confidence: 0 };
  const diagonal = Math.ceil(Math.hypot(width, height));
  const score = (degrees: number) => {
    const sin = Math.sin((degrees * Math.PI) / 180),
      cos = Math.cos((degrees * Math.PI) / 180);
    const rows = new Uint32Array(diagonal + 2),
      columns = new Uint32Array(diagonal + 2);
    for (const [x, y] of points) {
      rows[Math.floor(x * sin + y * cos + diagonal / 2)]++;
      columns[Math.floor(x * cos - y * sin + diagonal / 2)]++;
    }
    let result = 0;
    for (let i = 0; i < rows.length; i++)
      result += rows[i] ** 2 + columns[i] ** 2;
    return result;
  };
  const baseline = score(0);
  let best = baseline,
    angle = 0;
  for (let correction = -5; correction <= 5; correction += 0.25) {
    const candidate = score(correction);
    if (candidate > best) {
      best = candidate;
      angle = correction;
    }
  }
  const confidence = Math.min(1, Math.max(0, (best / baseline - 1) / 0.5));
  return {
    correctionDegree:
      best >= baseline * 1.08 && Math.abs(angle) < 5 ? angle : 0,
    confidence,
  };
}
