import { useEffect, useState } from "react";
import type { DrawingRef, Finding, StudyDocument } from "../model";
import { loadBlob } from "../storage";
import { transformBox } from "../ingestion/geometry";
import type { Matrix } from "../ingestion/types";
import { nameOf } from "./values";
import { DiagramDrawing, sceneGeometry } from "./diagram";
export default function SourceDrawing({
  doc,
  selected,
  onSelect,
  findings,
  focus,
}: {
  doc: StudyDocument;
  focus?: DrawingRef | null;
  selected: string;
  onSelect: (id: string) => void;
  findings: Finding[];
}) {
  const [choice, setChoice] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const all = doc.source_files.flatMap((f) =>
    f.pages.map((p) => ({ file: f, page: p, key: `${f.file_id}:${p.page}` })),
  );
  const selectedElement = doc.elements.find((e) => e.id === selected);
  const selectedRef =
    focus ??
    (selectedElement?.source_ref.kind === "drawing"
      ? selectedElement.source_ref.primary
      : null);
  const active =
    all.find(
      (p) =>
        selectedRef &&
        p.file.file_id === selectedRef.file_id &&
        p.page.page === selectedRef.page,
    ) ??
    all.find((p) => p.key === choice) ??
    all[0];
  const activeKey = active?.key;
  useEffect(() => {
    let alive = true;
    let objectURL = "";
    if (activeKey)
      void loadBlob(`page:${activeKey}`)
        .then((blob) => {
          if (!alive) return;
          if (blob) {
            objectURL = URL.createObjectURL(blob);
            setUrl(objectURL);
            setError("");
          } else {
            setUrl("");
            setError(
              "The source page is not stored in this browser. Re-upload the original drawing to view it.",
            );
          }
        })
        .catch(() => {
          if (alive) setError("Could not read the locally stored source page.");
        });
    return () => {
      alive = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [activeKey]);
  const refFor = (
    source: StudyDocument["elements"][number]["source_ref"],
  ): DrawingRef | null =>
    source.kind === "drawing"
      ? source.primary
      : source.kind === "synthetic"
        ? source.generated_drawing
        : source.manually_marked_region;
  const geometry = sceneGeometry(doc);
  const focusBox =
    focus &&
    active &&
    focus.file_id === active.file.file_id &&
    focus.page === active.page.page
      ? transformBox(
          {
            x_min: focus.bbox.x_min * active.page.original_width,
            y_min: focus.bbox.y_min * active.page.original_height,
            x_max: focus.bbox.x_max * active.page.original_width,
            y_max: focus.bbox.y_max * active.page.original_height,
          },
          active.page.deskew_transform as Matrix,
        )
      : null;
  return (
    <section className="panel source-panel">
      <div className="panel-header">
        <h3>Original drawing</h3>
        {all.length > 0 && (
          <select
            aria-label="Source page"
            value={active?.key ?? ""}
            onChange={(e) => {
              setChoice(e.target.value);
              onSelect("");
            }}
          >
            {all.map((p) => (
              <option value={p.key} key={p.key}>
                {p.file.name} · p{p.page.page}
              </option>
            ))}
          </select>
        )}
      </div>
      {!active ? (
        <>
          <p className="synthetic-note">
            Synthetic fixture — generated from the case, no uploaded source
            sheet.
          </p>
          <svg
            className="source-canvas"
            viewBox={`${geometry.bounds.x} ${geometry.bounds.y} ${geometry.bounds.width} ${geometry.bounds.height}`}
          >
            <DiagramDrawing
              doc={{ ...doc, solution: null }}
              selected={selected}
              onSelect={onSelect}
            />
          </svg>
        </>
      ) : error ? (
        <div className="empty-state">
          <p>{error}</p>
        </div>
      ) : url ? (
        <div className="source-scroll">
          <svg
            className="source-canvas"
            viewBox={`0 0 ${active.page.raster_width} ${active.page.raster_height}`}
          >
            <image
              href={url}
              width={active.page.raster_width}
              height={active.page.raster_height}
            />
            {doc.elements.map((e) => {
              const source = refFor(e.source_ref);
              if (
                !source ||
                source.file_id !== active.file.file_id ||
                source.page !== active.page.page
              )
                return null;
              const raw = {
                x_min: source.bbox.x_min * active.page.original_width,
                y_min: source.bbox.y_min * active.page.original_height,
                x_max: source.bbox.x_max * active.page.original_width,
                y_max: source.bbox.y_max * active.page.original_height,
              };
              const box = transformBox(
                raw,
                active.page.deskew_transform as Matrix,
              );
              const finding = findings.some((f) =>
                f.element_ids.includes(e.id),
              );
              return (
                <rect
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Source region ${nameOf(e)}`}
                  onClick={() => onSelect(e.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      onSelect(e.id);
                  }}
                  x={box.x_min}
                  y={box.y_min}
                  width={box.x_max - box.x_min}
                  height={box.y_max - box.y_min}
                  fill={e.id === selected ? "#4f91df33" : "transparent"}
                  stroke={
                    e.id === selected
                      ? "#185db3"
                      : finding
                        ? "#925c00"
                        : "#56647588"
                  }
                  strokeWidth={e.id === selected ? 5 : 2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {focusBox && (
              <rect
                aria-label="Selected unresolved endpoint"
                x={focusBox.x_min}
                y={focusBox.y_min}
                width={Math.max(12, focusBox.x_max - focusBox.x_min)}
                height={Math.max(12, focusBox.y_max - focusBox.y_min)}
                fill="#ffb02044"
                stroke="#b65c00"
                strokeWidth="4"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>
      ) : (
        <div className="empty-state">
          <p>Loading the source page…</p>
        </div>
      )}
      <div className="table-foot">
        Source boxes use the original page coordinate system and recorded deskew
        transform.
      </div>
    </section>
  );
}
