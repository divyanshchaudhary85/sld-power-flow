import type { Box, StudyDocument } from "../model/types";
import { iou } from "../ingestion/geometry";
import type { ElementType } from "./types";

export interface EvaluationTruth {
  id: string;
  components: {
    id: string;
    type: ElementType;
    label: string | null;
    page: number;
    bbox: Box;
  }[];
  /** Each endpoint is an explicit component ID and terminal role. */
  connections: [
    { element: string; role: string },
    { element: string; role: string },
  ][];
}
export interface Scores {
  truePositives: number;
  predicted: number;
  expected: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}
function score(correct: number, predicted: number, expected: number): Scores {
  const precision = predicted ? correct / predicted : null,
    recall = expected ? correct / expected : null;
  return {
    truePositives: correct,
    predicted,
    expected,
    precision,
    recall,
    f1:
      precision !== null && recall !== null
        ? precision + recall
          ? (2 * precision * recall) / (precision + recall)
          : 0
        : null,
  };
}
const textKey = (text: string) =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/** Evaluation of supplied truth, never a claim that deterministic fixture observations came from a live model. */
export function evaluateExtraction(
  document: StudyDocument,
  truth: EvaluationTruth,
  mode: "deterministic_fixture" | "live_vision" = "deterministic_fixture",
) {
  const pairs: { observed: number; expected: number; overlap: number }[] = [];
  document.elements.forEach((element, observed) => {
    if (element.source_ref.kind !== "drawing") return;
    const source = element.source_ref.primary;
    truth.components.forEach((expected, index) => {
      if (
        element.type.value === expected.type &&
        source.page === expected.page
      ) {
        const overlap = iou(source.bbox, expected.bbox);
        if (overlap >= 0.5) pairs.push({ observed, expected: index, overlap });
      }
    });
  });
  const matchedObserved = new Set<number>(),
    matchedExpected = new Set<number>(),
    mapping = new Map<string, string>();
  let correctText = 0;
  for (const pair of pairs.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      a.observed - b.observed ||
      a.expected - b.expected,
  )) {
    if (
      matchedObserved.has(pair.observed) ||
      matchedExpected.has(pair.expected)
    )
      continue;
    matchedObserved.add(pair.observed);
    matchedExpected.add(pair.expected);
    const element = document.elements[pair.observed],
      expected = truth.components[pair.expected];
    mapping.set(element.id, expected.id);
    if (
      element.label.status === "known" &&
      expected.label !== null &&
      textKey(element.label.value) === textKey(expected.label)
    )
      correctText++;
  }
  const nets = new Map<string, string[]>();
  for (const element of document.elements)
    for (const [role, terminal] of Object.entries(element.terminals)) {
      if (terminal.connection_point.status !== "known") continue;
      const point = terminal.connection_point.value;
      nets.set(point, [
        ...(nets.get(point) ?? []),
        `${mapping.get(element.id) ?? `unmatched:${element.id}`}:${role}`,
      ]);
    }
  const predictedEdges = new Set<string>();
  for (const net of nets.values())
    for (let i = 0; i < net.length; i++)
      for (let j = i + 1; j < net.length; j++)
        predictedEdges.add(pairKey(net[i], net[j]));
  const expectedEdges = new Set(
    truth.connections.map(([a, b]) =>
      pairKey(`${a.element}:${a.role}`, `${b.element}:${b.role}`),
    ),
  );
  return {
    fixture: truth.id,
    mode,
    claim:
      mode === "deterministic_fixture"
        ? "Measures deterministic merge/topology code against supplied synthetic observations; not live vision accuracy."
        : "Measures this specific provider run against supplied human-labelled truth; not a general accuracy guarantee.",
    components: score(
      mapping.size,
      document.elements.length,
      truth.components.length,
    ),
    text: score(
      correctText,
      document.elements.filter((element) => element.label.status === "known")
        .length,
      truth.components.filter((element) => element.label !== null).length,
    ),
    connections: score(
      [...predictedEdges].filter((edge) => expectedEdges.has(edge)).length,
      predictedEdges.size,
      expectedEdges.size,
    ),
  };
}
