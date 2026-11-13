import { useEffect, useMemo, useRef, useState } from "react";
import type { Element, Finding, Point, StudyDocument } from "../model";
import { known, nameOf, format, resultValue } from "./values";
import { analyzeTopology } from "../validation";
import { defaultDependent, flowArrow } from "./resultQuality";

export const isBranch = (e: Element) => Object.keys(e.terminals).length === 2;
export function sceneGeometry(doc: StudyDocument) {
  const points = new Map(
    doc.connectivity_points.map((p) => [p.id, p.position]),
  );
  const positions = new Map<string, Point>();
  for (const e of doc.elements) {
    const terminals = Object.values(e.terminals)
      .map((t) => points.get(known(t.connection_point) ?? ""))
      .filter((p): p is Point => !!p);
    let p = e.layout.position;
    if (isBranch(e) && terminals.length === 2)
      p = {
        x: (terminals[0].x + terminals[1].x) / 2,
        y: (terminals[0].y + terminals[1].y) / 2,
      };
    else if (
      e.type.value !== "busbar" &&
      terminals[0] &&
      Math.hypot(p.x - terminals[0].x, p.y - terminals[0].y) < 15
    ) {
      const load = ["load", "motor", "shunt"].includes(e.type.value);
      p = { x: p.x, y: p.y + (load ? 85 : -85) };
    }
    positions.set(e.id, p);
  }
  const all = [...positions.values(), ...points.values()];
  const minX = (all.length ? Math.min(...all.map((p) => p.x)) : 0) - 110,
    minY = (all.length ? Math.min(...all.map((p) => p.y)) : 0) - 100;
  const width = Math.max(400, ...all.map((p) => p.x)) - minX + 130,
    height = Math.max(250, ...all.map((p) => p.y)) - minY + 130;
  return { points, positions, bounds: { x: minX, y: minY, width, height } };
}
export function SymbolGlyph({
  kind,
  open = false,
  ansi = false,
}: {
  kind: string;
  open?: boolean;
  ansi?: boolean;
}) {
  switch (kind) {
    case "busbar":
      return <path d="M-38 0H38" strokeWidth="6" />;
    case "transformer_2w":
      return ansi ? (
        <>
          <circle cx="-10" cy="0" r="16" />
          <circle cx="10" cy="0" r="16" />
        </>
      ) : (
        <>
          <circle cx="0" cy="-9" r="15" />
          <circle cx="0" cy="9" r="15" />
        </>
      );
    case "circuit_breaker":
      return (
        <>
          <path d="M0-25V-11M0 11V25" />
          <rect
            x="-10"
            y="-11"
            width="20"
            height="22"
            fill={open ? "none" : "currentColor"}
          />
          {open && <path d="M-8 8L8-8" />}
        </>
      );
    case "disconnector":
      return (
        <>
          <path d="M0-26V-12M0 12V26" />
          <path d={open ? "M0 12L16-10" : "M0 12V-12"} />
          <circle cy="12" r="2" />
        </>
      );
    case "fuse":
      return (
        <>
          <path d="M0-25V25" />
          <rect x="-6" y="-15" width="12" height="30" />
          {open && <path d="M-9 9L9-9" />}
        </>
      );
    case "generator":
      return (
        <>
          <circle r="22" />
          <path d="M-13 0Q-6-17 0 0T13 0" />
        </>
      );
    case "external_grid":
      return (
        <>
          <rect x="-20" y="-20" width="40" height="40" />
          <path d="M-20-20L20 20M-20 20L20-20M-20 0H20M0-20V20" />
        </>
      );
    case "static_generator":
      return (
        <>
          <rect x="-20" y="-18" width="40" height="36" />
          <path d="M-20 18L20-18M-12-8H-3M3 7Q8-2 12 7" />
        </>
      );
    case "load":
    case "motor":
      return kind === "motor" ? (
        <>
          <circle r="20" />
          <text
            stroke="none"
            fill="currentColor"
            textAnchor="middle"
            y="6"
            fontSize="17"
          >
            M
          </text>
        </>
      ) : (
        <path
          d={ansi ? "M0-20V18M-14 3L0 18 14 3" : "M0-20V-8M-17-8H17L0 20Z"}
        />
      );
    case "shunt":
      return (
        <>
          <path d="M0-24V-5M-18-5H18M-18 5H18M0 5V23M-13 23H13M-8 28H8" />
        </>
      );
    case "unknown":
      return (
        <>
          <path d="M0-22L22 0 0 22-22 0Z" />
          <text stroke="none" fill="currentColor" textAnchor="middle" y="6">
            ?
          </text>
        </>
      );
    default:
      return <path d="M-23 0H23" />;
  }
}
export function DiagramDrawing({
  doc,
  selected,
  onSelect,
  findings = [],
  light = false,
}: {
  doc: StudyDocument;
  selected?: string;
  onSelect?: (id: string) => void;
  findings?: Finding[];
  light?: boolean;
}) {
  const geometry = sceneGeometry(doc);
  const run = doc.solution?.status === "converged" ? doc.solution : null;
  const dead = new Set(analyzeTopology(doc).deenergizedPointIds);
  const ansi = known(doc.meta.symbol_set) === "ANSI_IEEE";
  const colors = light
    ? {
        normal: "#475569",
        text: "#172333",
        surface: "#fff",
        muted: "#566475",
        critical: "#a92335",
        warning: "#825700",
        selected: "#185db3",
      }
    : {
        normal: "var(--muted)",
        text: "var(--text)",
        surface: "var(--bg)",
        muted: "var(--muted)",
        critical: "var(--critical)",
        warning: "var(--warning)",
        selected: "var(--accent)",
      };
  return (
    <g fontFamily="Inter,Arial,sans-serif" fontSize="15" fill={colors.text}>
      {doc.elements.map((e) => {
        const pos = geometry.positions.get(e.id)!;
        const terminals = Object.values(e.terminals);
        const refs = terminals.map(
          (t) => known<string>(t.connection_point) ?? "",
        );
        const ends = refs.map((id) => geometry.points.get(id));
        const switchKind = ["circuit_breaker", "disconnector", "fuse"].includes(
          e.type.value,
        );
        const open =
          switchKind &&
          known(
            (e.data as Record<string, { status: string; value?: unknown }>)
              .state,
          ) === "open";
        const inactive =
          known(e.in_service) === false ||
          open ||
          (refs.length > 0 && refs.every((p) => dead.has(p)));
        const f = findings.find(
          (f) =>
            f.element_ids.includes(e.id) &&
            ["alarm", "error", "warning"].includes(f.severity),
        );
        let color =
          e.id === selected
            ? colors.selected
            : f?.severity === "error" || f?.severity === "alarm"
              ? colors.critical
              : f?.severity === "warning"
                ? colors.warning
                : colors.normal;
        if (
          switchKind &&
          doc.operation.display_preferences.breaker_colour_convention !==
            "shape_only" &&
          !open
        )
          color =
            doc.operation.display_preferences.breaker_colour_convention ===
            "closed_red"
              ? "#cc4750"
              : "#328465";
        const branch = run?.results?.lines.find((r) => r.element_id === e.id);
        const transformer = run?.results?.transformers.find(
          (r) => r.element_id === e.id,
        );
        const bus = run?.results?.buses.find((r) =>
          r.busbar_ids.includes(e.id),
        );
        const load = run?.results?.loads.find((r) => r.element_id === e.id);
        const gen = [
          ...(run?.results?.generators ?? []),
          ...(run?.results?.external_grids ?? []),
        ].find((r) => r.element_id === e.id);
        const loading = resultValue(
          branch?.loading_percent ?? transformer?.loading_percent,
        );
        const resultPath = branch
          ? `/results/lines/${run!.results!.lines.indexOf(branch)}`
          : transformer
            ? `/results/transformers/${run!.results!.transformers.indexOf(transformer)}`
            : bus
              ? `/results/buses/${run!.results!.buses.indexOf(bus)}`
              : load
                ? `/results/loads/${run!.results!.loads.indexOf(load)}`
                : gen
                  ? run!.results!.external_grids.includes(gen)
                    ? `/results/external_grids/${run!.results!.external_grids.indexOf(gen)}`
                    : `/results/generators/${run!.results!.generators.indexOf(gen)}`
                  : "";
        const hasDefaults = !!resultPath && defaultDependent(doc, resultPath);
        const a = ends[0],
          b = ends[1];
        const route = e.layout.route_points;
        const path =
          a && b
            ? route.length > 1
              ? `M${route.map((p) => `${p.x},${p.y}`).join(" L")}`
              : `M${a.x},${a.y} H${pos.x} V${b.y} H${b.x}`
            : a && e.type.value !== "busbar"
              ? `M${a.x},${a.y} V${pos.y} H${pos.x}`
              : "";
        return (
          <g
            key={e.id}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={`${nameOf(e)} ${e.type.value}${switchKind ? (open ? " open" : " closed") : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(e.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect?.(e.id);
              }
            }}
            className="diagram-equipment"
            opacity={inactive ? 0.42 : 1}
            style={{ cursor: onSelect ? "pointer" : "default", color }}
          >
            <title>{`${e.id}: ${nameOf(e)}${f ? ` — ${f.severity}: ${f.message}` : ""}`}</title>
            {path && (
              <>
                <path
                  d={path}
                  stroke="transparent"
                  strokeWidth="18"
                  fill="none"
                />
                <path
                  d={path}
                  stroke={color}
                  strokeWidth={e.id === selected ? 3 : 1.8}
                  strokeDasharray={inactive ? "7 5" : undefined}
                  fill="none"
                />
              </>
            )}
            <g transform={`translate(${pos.x} ${pos.y})`}>
              {!["line", "cable"].includes(e.type.value) && (
                <g stroke={color} fill={colors.surface} strokeWidth="2">
                  <SymbolGlyph kind={e.type.value} open={open} ansi={ansi} />
                </g>
              )}
              {e.id === selected && (
                <rect
                  x="-49"
                  y="-34"
                  width="98"
                  height="68"
                  stroke={color}
                  fill="none"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              )}
              <text
                y={isBranch(e) ? -28 : -34}
                textAnchor="middle"
                fill={colors.text}
                paintOrder="stroke"
                stroke={colors.surface}
                strokeWidth="4"
              >
                {nameOf(e)}
                {hasDefaults ? " ◇" : ""}
              </text>
              {switchKind && (
                <text
                  y="40"
                  textAnchor="middle"
                  fontSize="9"
                  fill={colors.muted}
                >
                  {open ? "OPEN" : "CLOSED"}
                </text>
              )}
              {bus && (
                <text
                  y="22"
                  textAnchor="middle"
                  fontSize="13"
                  fill={colors.text}
                  paintOrder="stroke"
                  stroke={colors.surface}
                  strokeWidth="3"
                >
                  {format(bus.voltage_kv, 2)} kV · {format(bus.voltage_pu, 3)}{" "}
                  pu
                </text>
              )}
              {(load || gen) && (
                <text y="37" textAnchor="middle" fill={colors.muted}>
                  {format((load || gen)?.p_mw, 2)} MW /{" "}
                  {format((load || gen)?.q_mvar, 2)} MVAr
                </text>
              )}
              {loading !== null && (
                <>
                  <rect
                    x="-30"
                    y="10"
                    width="60"
                    height="5"
                    fill={colors.surface}
                    stroke={colors.muted}
                  />
                  <rect
                    x="-30"
                    y="10"
                    width={Math.min(60, Math.max(0, loading) * 0.5)}
                    height="5"
                    fill={color}
                  />
                  <path d="M20 8V18" stroke={colors.text} />
                  <text y="30" textAnchor="middle" fill={colors.muted}>
                    {loading.toFixed(1)}% · limit 100%
                  </text>
                </>
              )}
              {f && (
                <text x="46" y="-14" fontSize="14" fill={color}>
                  {f.severity === "warning" ? "△" : "⊗"}
                </text>
              )}
            </g>
            {(branch || transformer) &&
              a &&
              b &&
              [0, 1].map((end) => {
                const p = end === 0 ? a : b;
                const x = p.x + (pos.x - p.x) * 0.38,
                  y = p.y + (pos.y - p.y) * 0.38;
                const pval =
                  end === 0
                    ? (branch?.p_from_mw ?? transformer?.p_hv_mw)
                    : (branch?.p_to_mw ?? transformer?.p_lv_mw);
                const qval =
                  end === 0
                    ? (branch?.q_from_mvar ?? transformer?.q_hv_mvar)
                    : (branch?.q_to_mvar ?? transformer?.q_lv_mvar);
                return (
                  <text
                    key={end}
                    x={x}
                    y={y - 6}
                    textAnchor="middle"
                    fill={colors.muted}
                    fontSize="12"
                    paintOrder="stroke"
                    stroke={colors.surface}
                    strokeWidth="3"
                  >
                    {flowArrow(
                      resultValue(pval),
                      p,
                      route.length > 1
                        ? end === 0
                          ? route[1]
                          : route[route.length - 2]
                        : pos,
                    )}{" "}
                    {format(pval, 1)} MW / {format(qval, 1)} MVAr
                  </text>
                );
              })}
          </g>
        );
      })}
    </g>
  );
}
export function Diagram({
  doc,
  selected,
  onSelect,
  findings = [],
}: {
  doc: StudyDocument;
  selected?: string;
  onSelect: (id: string) => void;
  findings?: Finding[];
}) {
  const geometry = useMemo(() => sceneGeometry(doc), [doc]);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(
    null,
  );
  useEffect(() => {
    if (!selected) return;
    const point = geometry.positions.get(selected);
    if (!point) return;
    const frame = requestAnimationFrame(() =>
      setCamera({
        x: point.x - geometry.bounds.x - geometry.bounds.width / 4,
        y: point.y - geometry.bounds.y - geometry.bounds.height / 4,
        zoom: 2,
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selected, geometry]);
  const b = geometry.bounds;
  const width = b.width / camera.zoom,
    height = b.height / camera.zoom;
  const view = { x: b.x + camera.x, y: b.y + camera.y, width, height };
  const fit = () => setCamera({ x: 0, y: 0, zoom: 1 });
  const focus = () => {
    const p = selected && geometry.positions.get(selected);
    if (p)
      setCamera({
        x: p.x - b.x - b.width / 4,
        y: p.y - b.y - b.height / 4,
        zoom: 2,
      });
  };
  return (
    <div className="diagram-wrap">
      <div className="diagram-tools">
        <span>ONE-LINE · {known(doc.meta.symbol_set)}</span>
        <button
          onClick={() =>
            setCamera((c) => ({ ...c, zoom: Math.min(5, c.zoom * 1.25) }))
          }
          aria-label="Zoom in"
        >
          ＋
        </button>
        <button
          onClick={() =>
            setCamera((c) => ({ ...c, zoom: Math.max(0.4, c.zoom / 1.25) }))
          }
          aria-label="Zoom out"
        >
          −
        </button>
        <button onClick={fit}>Fit</button>
        <button disabled={!selected} onClick={focus}>
          Focus selection
        </button>
      </div>
      <svg
        className="one-line"
        aria-label="Interactive single-line diagram"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              cx: camera.x,
              cy: camera.y,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const rect = e.currentTarget.getBoundingClientRect();
            setCamera((c) => ({
              ...c,
              x:
                drag.current!.cx -
                ((e.clientX - drag.current!.x) * width) / rect.width,
              y:
                drag.current!.cy -
                ((e.clientY - drag.current!.y) * height) / rect.height,
            }));
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <DiagramDrawing
          doc={doc}
          selected={selected}
          onSelect={onSelect}
          findings={findings}
        />
      </svg>
      <svg
        className="minimap"
        aria-label="Diagram minimap"
        viewBox={`${b.x} ${b.y} ${b.width} ${b.height}`}
        onClick={fit}
      >
        {[...geometry.positions.entries()].map(([id, p]) => (
          <circle
            key={id}
            cx={p.x}
            cy={p.y}
            r="9"
            fill={id === selected ? "var(--accent)" : "var(--muted)"}
          />
        ))}
        <rect
          x={view.x}
          y={view.y}
          width={view.width}
          height={view.height}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="5"
        />
      </svg>
      <div className="diagram-legend">
        □ closed / ◩ open · dashed: unavailable or isolated · △ warning · ⊗
        alarm/error · ◇ default-dependent result
      </div>
    </div>
  );
}
export async function diagramSVG(doc: StudyDocument): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const b = sceneGeometry(doc).bounds;
  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={Math.ceil(b.width)}
      height={Math.ceil(b.height)}
      viewBox={`${b.x} ${b.y} ${b.width} ${b.height}`}
    >
      <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="#fff" />
      <DiagramDrawing doc={doc} light />
    </svg>,
  );
}
export async function diagramPNG(doc: StudyDocument): Promise<Uint8Array> {
  const svg = await diagramSVG(doc);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 2200 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not capture diagram.")),
        "image/png",
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
