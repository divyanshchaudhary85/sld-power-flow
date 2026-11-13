import { expect, it } from "vitest";
import { wrapText } from "../src/exports/wrapText";

it("keeps Unicode and long provenance text within shaped margins without quadratic measurements", () => {
  const text = "T1 → terminal α; ".repeat(200);
  let shapedCharacters = 0;
  const measure = (value: string) => {
    shapedCharacters += [...value].length;
    return [...value].length;
  };
  const lines = wrapText(text, measure, 80);
  expect(lines.join("")).toBe(text);
  expect(lines.every((line) => [...line].length <= 80)).toBe(true);
  expect(shapedCharacters).toBeLessThan(text.length * 3);
});
it("checks positive shaping adjustments and preserves paragraph breaks", () => {
  const measure = (value: string) =>
    value.length + Math.max(0, value.length - 1) * 0.5;
  const lines = wrapText("aaaaaa\nβββ", measure, 5);
  expect(lines.join("")).toBe("aaaaaaβββ");
  expect(lines.at(-1)).toBe("βββ");
  expect(lines.every((line) => measure(line) <= 5)).toBe(true);
});
