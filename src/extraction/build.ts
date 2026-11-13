import type {
  DrawingRef,
  Element,
  ExtractionRun,
  FieldID,
  Observation,
  Point,
  SourceRef,
  StudyDocument,
} from "../model/types";
import { assertStudyDocument } from "../model/validation";
import type { IngestedDocument } from "../ingestion/types";
import { denormalizeBox, intersectionArea } from "../ingestion/geometry";
import {
  createDraft,
  createElement,
  drawnField,
  missing,
  TERMINALS,
  withDrawingSource,
  type DraftOptions,
} from "./model";
import { populateAttributes } from "./attributes";
import {
  drawingRef,
  locateComponents,
  mergeComponents,
  originalPoint,
  pointInsideSegment,
  segmentOverlap,
  UnionFind,
} from "./merge";
import type {
  LocatedComponent,
  LocatedTileResponse,
  ReadEndpoint,
} from "./types";

const boxAround = (point: Point) => ({
  x_min: point.x,
  y_min: point.y,
  x_max: point.x,
  y_max: point.y,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function disposition(
  component: LocatedComponent,
): "legend" | "title_block" | null {
  const area =
    (component.bbox.x_max - component.bbox.x_min) *
    (component.bbox.y_max - component.bbox.y_min);
  for (const kind of ["legend", "title_block"] as const) {
    const normalized = component.source.page.metadata[kind];
    const region = normalized
      ? denormalizeBox(
          normalized,
          component.source.page.metadata.original_width,
          component.source.page.metadata.original_height,
        )
      : null;
    if (
      region &&
      area > 0 &&
      intersectionArea(component.bbox, region) / area > 0.8
    )
      return kind;
  }
  return null;
}
type Terminal = {
  id: string;
  role: string;
  connection_point: FieldID;
  source_ref: SourceRef;
  drawn_anchor: Point | null;
};
interface NodeInfo {
  point: Point;
  ref: DrawingRef;
  runId: string;
  confidence: number;
  terminal?: Terminal;
}
interface Wire {
  id: string;
  source: LocatedTileResponse;
  points: Point[];
  observation: Observation;
  confidence: number;
  ends: [ReadEndpoint, ReadEndpoint];
  joined: Set<string>;
}

/** Converts validated perception into a review draft. It never fills engineering gaps or runs a solver. */
export function buildDraft(
  ingested: IngestedDocument,
  sources: LocatedTileResponse[],
  run: ExtractionRun,
  options: DraftOptions = {},
): StudyDocument {
  const doc = createDraft({ ...options, origin: "uploaded" });
  doc.source_files = [structuredClone(ingested.sourceFile)];
  doc.extraction.runs = [structuredClone(run)];
  const fileId = ingested.sourceFile.file_id;
  const components = locateComponents(sources),
    byObservation = new Map(components.map((item) => [item.id, item]));
  const groups = mergeComponents(
    components.filter((component) => !disposition(component)),
  );
  const componentElements = new Map<string, Element>();
  const refsFor = (component: LocatedComponent) =>
    drawingRef(fileId, component.source, component.bbox);
  for (const component of components) {
    const ref = refsFor(component);
    doc.extraction.observations.push({
      id: component.id,
      tile_id: component.tileId,
      detected_type: drawnField(
        component.type,
        component.confidence,
        [ref],
        component.source.runId,
      ),
      label: component.label
        ? drawnField(
            component.label,
            component.confidence,
            [ref],
            component.source.runId,
          )
        : missing(),
      attributes: component.read.attributes.flatMap((attribute) => [
        {
          name: `${attribute.name}${attribute.unit ? ` [${attribute.unit}]` : ""}`,
          value: drawnField(
            attribute.number ?? attribute.text ?? attribute.boolean!,
            attribute.confidence,
            [ref],
            component.source.runId,
          ),
        },
        {
          name: `${attribute.name}:raw_text`,
          value: drawnField(
            attribute.raw_text,
            attribute.confidence,
            [ref],
            component.source.runId,
          ),
        },
      ]),
      source_ref: ref,
      confidence: component.confidence,
      terminals: component.terminals.map((terminal) => ({
        id: `${component.id}/terminal/${terminal.id}`,
        observation_id: component.id,
        position: terminal.point,
        source_ref: drawingRef(
          fileId,
          component.source,
          boxAround(terminal.point),
        ),
        attached_observation_id: missing(),
      })),
      line_paths: [],
    });
    const kind = disposition(component);
    if (kind) {
      const layoutElement = createElement(
        component.type,
        `annotation-${doc.extraction.annotations.length + 1}`,
      );
      withDrawingSource(
        layoutElement,
        ref,
        component.source.runId,
        component.confidence,
      );
      doc.extraction.annotations.push({
        id: layoutElement.id,
        text: component.label ?? component.type,
        source_ref: layoutElement.source_ref,
        layout: layoutElement.layout,
        disposition: kind,
        review: layoutElement.review,
      });
    }
  }
  for (const group of groups) {
    const selected = group.selected,
      element = createElement(selected.type, group.id),
      refs = group.members.map(refsFor);
    withDrawingSource(
      element,
      refsFor(selected),
      selected.source.runId,
      selected.confidence,
    );
    element.layout.position = {
      x: (selected.bbox.x_min + selected.bbox.x_max) / 2,
      y: (selected.bbox.y_min + selected.bbox.y_max) / 2,
    };
    element.layout.width = selected.bbox.x_max - selected.bbox.x_min;
    element.layout.height = selected.bbox.y_max - selected.bbox.y_min;
    if (element.source_ref.kind === "drawing")
      element.source_ref.evidence = refs;
    const labels = [
      ...new Set(
        group.members
          .map((member) => member.label)
          .filter((label): label is string => !!label),
      ),
    ];
    element.label =
      labels.length === 1
        ? drawnField(
            labels[0],
            selected.confidence,
            refs,
            selected.source.runId,
          )
        : missing();
    populateAttributes(
      element,
      group.members.flatMap((member) =>
        member.read.attributes.map((attribute) => ({
          attribute,
          ref: refsFor(member),
          runId: member.source.runId,
        })),
      ),
    );
    doc.elements.push(element);
    group.members.forEach((member) =>
      componentElements.set(member.id, element),
    );
    doc.extraction.merge_decisions.push({
      observation_ids: group.members.map((member) => member.id),
      outcome: group.members.length > 1 ? "merged" : "kept_distinct",
      rule_id: "same-page-type-label-complete-link-iou-045-v1",
      element_ids: [element.id],
      description:
        group.members.length > 1
          ? "Overlapping tile observations with consistent type and label; all sources retained. Conflicting attributes remain missing."
          : "No unambiguous overlapping duplicate.",
    });
  }

  const graph = new UnionFind(),
    nodes = new Map<string, NodeInfo>(),
    wires: Wire[] = [];
  const terminalNode = (
    componentId: string,
    terminalId: string,
  ): string | null => {
    const component = byObservation.get(componentId),
      element = componentElements.get(componentId);
    if (!component || !element) return null;
    const observed = component.terminals.find((t) => t.id === terminalId);
    if (!observed) return null;
    const roles = TERMINALS[element.type.value],
      role =
        observed.role === "unknown" && roles.length === 1
          ? roles[0]
          : observed.role;
    const terminal = (element.terminals as Record<string, Terminal>)[role];
    if (!terminal) return null;
    const id = `terminal/${element.id}/${role}`,
      ref = drawingRef(fileId, component.source, boxAround(observed.point));
    if (!nodes.has(id))
      nodes.set(id, {
        point: observed.point,
        ref,
        runId: component.source.runId,
        confidence: observed.confidence,
        terminal,
      });
    graph.find(id);
    terminal.drawn_anchor = observed.point;
    return id;
  };
  for (const component of components)
    for (const terminal of component.terminals)
      terminalNode(component.id, terminal.id);
  for (const source of sources) {
    for (const [index, text] of source.result.unassociated_text.entries()) {
      const points = [
        originalPoint(source, [text.bbox[0], text.bbox[1]]),
        originalPoint(source, [text.bbox[2], text.bbox[3]]),
      ];
      const ref = drawingRef(fileId, source, {
        x_min: Math.min(...points.map((p) => p.x)),
        y_min: Math.min(...points.map((p) => p.y)),
        x_max: Math.max(...points.map((p) => p.x)),
        y_max: Math.max(...points.map((p) => p.y)),
      });
      doc.extraction.unassociated_text.push({
        id: `${source.tile.metadata.id}/text/${index}`,
        text: drawnField(text.text, text.confidence, [ref], source.runId),
        source_ref: ref,
        associated_element_id: missing(),
      });
    }
    for (const stroke of source.result.strokes) {
      const id = `${source.tile.metadata.id}/wire/${stroke.id}`,
        points = stroke.points.map((point) => originalPoint(source, point));
      const ref = drawingRef(fileId, source, {
        x_min: Math.min(...points.map((p) => p.x)),
        y_min: Math.min(...points.map((p) => p.y)),
        x_max: Math.max(...points.map((p) => p.x)),
        y_max: Math.max(...points.map((p) => p.y)),
      });
      const observation: Observation = {
        id,
        tile_id: source.tile.metadata.id,
        detected_type: drawnField(
          "unknown",
          stroke.confidence,
          [ref],
          source.runId,
        ),
        label: missing(),
        attributes: [
          {
            name: "perception_kind",
            value: drawnField(
              "connection_stroke",
              stroke.confidence,
              [ref],
              source.runId,
            ),
          },
        ],
        source_ref: ref,
        confidence: stroke.confidence,
        terminals: [],
        line_paths: [points],
      };
      doc.extraction.observations.push(observation);
      graph.find(id);
      const insideAnnotation = ["legend", "title_block"].some((kind) => {
        const normalized =
          source.page.metadata[kind as "legend" | "title_block"];
        if (!normalized) return false;
        const box = denormalizeBox(
          normalized,
          source.page.metadata.original_width,
          source.page.metadata.original_height,
        );
        return points.every(
          (point) =>
            point.x >= box.x_min &&
            point.x <= box.x_max &&
            point.y >= box.y_min &&
            point.y <= box.y_max,
        );
      });
      if (insideAnnotation) continue;
      nodes.set(id, {
        point: points[0],
        ref,
        runId: source.runId,
        confidence: stroke.confidence,
      });
      const wire: Wire = {
        id,
        source,
        points,
        observation,
        confidence: stroke.confidence,
        ends: [stroke.from, stroke.to],
        joined: new Set(),
      };
      wires.push(wire);
      wire.ends.forEach((end, index) => {
        const componentId = `${source.tile.metadata.id}/component/${end.component_id}`;
        const node =
          end.component_id && end.terminal_id
            ? terminalNode(componentId, end.terminal_id)
            : null;
        if (node) graph.join(id, node);
        const point = points[index === 0 ? 0 : points.length - 1];
        observation.terminals.push({
          id: `${id}/end/${index}`,
          observation_id: id,
          position: point,
          source_ref: drawingRef(fileId, source, boxAround(point)),
          attached_observation_id: node
            ? drawnField(componentId, stroke.confidence, [ref], source.runId)
            : missing(),
        });
      });
    }
    for (const junction of source.result.junctions) {
      const ids = junction.stroke_ids.map(
        (id) => `${source.tile.metadata.id}/wire/${id}`,
      );
      for (const id of ids.slice(1)) graph.join(ids[0], id);
      const position = originalPoint(source, junction.point);
      const tolerance =
        Math.max(
          source.page.metadata.original_width /
            source.page.metadata.raster_width,
          source.page.metadata.original_height /
            source.page.metadata.raster_height,
        ) * 2.5;
      for (const id of ids) {
        const wire = wires.find((candidate) => candidate.id === id);
        for (const endpoint of wire?.observation.terminals ?? [])
          if (
            distance(position, endpoint.position) <= tolerance &&
            endpoint.attached_observation_id.status === "missing"
          ) {
            endpoint.attached_observation_id = drawnField(
              ids.find((other) => other !== id)!,
              junction.confidence,
              [endpoint.source_ref],
              source.runId,
            );
          }
      }
    }
  }
  const toleranceFor = (source: LocatedTileResponse) =>
    Math.max(
      source.page.metadata.original_width / source.page.metadata.raster_width,
      source.page.metadata.original_height / source.page.metadata.raster_height,
    ) * 2.5;
  // Duplicate collinear segments in separate overlapping tiles represent one wire. A crossing alone never joins nets.
  for (let i = 0; i < wires.length; i++)
    for (let j = i + 1; j < wires.length; j++) {
      const a = wires[i],
        b = wires[j];
      if (
        a.source.page.metadata.page !== b.source.page.metadata.page ||
        a.source.tile.metadata.id === b.source.tile.metadata.id
      )
        continue;
      const tolerance = toleranceFor(a.source);
      if (
        a.points
          .slice(1)
          .some((end, k) =>
            b.points
              .slice(1)
              .some((other, l) =>
                segmentOverlap(a.points[k], end, b.points[l], other, tolerance),
              ),
          )
      ) {
        graph.join(a.id, b.id);
        a.joined.add(b.id);
        b.joined.add(a.id);
      }
    }
  const pointGroups = new Map<string, [string, NodeInfo][]>();
  for (const node of nodes) {
    const root = graph.find(node[0]);
    pointGroups.set(root, [...(pointGroups.get(root) ?? []), node]);
  }
  for (const members of pointGroups.values()) {
    const id = `point-${doc.connectivity_points.length + 1}`,
      refs = members.map(([, info]) => info.ref),
      first = members[0][1];
    doc.connectivity_points.push({
      id,
      position: first.point,
      source_ref: { kind: "drawing", primary: first.ref, evidence: refs },
      kind: members.length > 1 ? "junction" : "terminal_point",
      evidence: refs,
    });
    for (const [, info] of members)
      if (info.terminal)
        info.terminal.connection_point = drawnField(
          id,
          Math.min(...members.map(([, n]) => n.confidence)),
          refs,
          info.runId,
        );
  }
  for (const wire of wires)
    for (const endpoint of wire.observation.terminals) {
      if (endpoint.attached_observation_id.status === "known") continue;
      const tolerance = toleranceFor(wire.source);
      const continued = wires.some(
        (other) =>
          wire.joined.has(other.id) &&
          other.points
            .slice(1)
            .some((end, index) =>
              pointInsideSegment(
                endpoint.position,
                other.points[index],
                end,
                tolerance,
              ),
            ),
      );
      if (
        !continued &&
        !doc.extraction.unresolved_endpoints.some(
          (other) =>
            other.source_ref.page === endpoint.source_ref.page &&
            distance(other.position, endpoint.position) <= tolerance,
        )
      )
        doc.extraction.unresolved_endpoints.push(endpoint);
    }
  doc.review.unresolved_element_ids = doc.elements.map((element) => element.id);
  assertStudyDocument(doc);
  return doc;
}
