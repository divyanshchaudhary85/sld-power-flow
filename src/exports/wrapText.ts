/** Cached glyph widths keep long provenance registers from repeatedly shaping every prefix. */
export function wrapText(
  text: string,
  measure: (text: string) => number,
  maxWidth: number,
): string[] {
  const widths = new Map<string, number>();
  const result: string[] = [];
  const emit = (value: string) => {
    // Verify the actual shaped line as well, so kerning cannot push text past the margin.
    let remaining = [...value];
    while (remaining.length && measure(remaining.join("")) > maxWidth) {
      let low = 1,
        high = remaining.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (measure(remaining.slice(0, middle).join("")) <= maxWidth)
          low = middle;
        else high = middle - 1;
      }
      result.push(remaining.slice(0, low).join(""));
      remaining = remaining.slice(low);
    }
    if (remaining.length || !value) result.push(remaining.join(""));
  };
  for (const paragraph of text.split("\n")) {
    let line = "",
      width = 0;
    for (const char of paragraph) {
      if (!widths.has(char)) widths.set(char, measure(char));
      const next = widths.get(char)!;
      if (line && width + next > maxWidth) {
        emit(line);
        line = "";
        width = 0;
      }
      line += char;
      width += next;
    }
    emit(line);
  }
  return result;
}
