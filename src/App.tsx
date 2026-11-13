import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { commitEngineeringEdit, confirmReview } from "./model";
import type { DrawingRef, Finding, JsonValue, StudyDocument } from "./model";
import { updateInput, reconnectTerminal, removeElement } from "./model/editing";
import { useWorkspace } from "./useWorkspace";
import { validateNetwork } from "./validation";
import { operate, baseDifferences, resetBase, captureBase } from "./operations";
import { Diagram, diagramSVG } from "./ui/diagram";
import Inspector from "./ui/Inspector";
import ConfirmDialog from "./ui/ConfirmDialog";
import Completion from "./ui/Completion";
import EndpointReview from "./ui/EndpointReview";
import { DataGrid, Findings } from "./ui/Tables";
import { known, nameOf, format, download } from "./ui/values";
import { solutionTables } from "./exports/tables";
import { compareWithReference } from "./proof";
import { createElement, createDraft, retypeElement } from "./extraction/model";
import { ELEMENT_TYPES, type ElementType } from "./extraction/types";
const Upload = lazy(() => import("./ui/Upload"));
const ExportPanel = lazy(() => import("./ui/ExportPanel"));
const SourceDrawing = lazy(() => import("./ui/SourceDrawing"));
const VisionProof = lazy(() => import("./ui/VisionProof"));
type Tab =
  | "operate"
  | "upload"
  | "review"
  | "validate"
  | "complete"
  | "export"
  | "settings"
  | "proof";
const navigation: { tab: Tab; icon: string; name: string }[] = [
  { tab: "operate", icon: "⌘", name: "Operator console" },
  { tab: "upload", icon: "↑", name: "Upload & extract" },
  { tab: "review", icon: "⊞", name: "Review drawing" },
  { tab: "validate", icon: "✓", name: "Validate" },
  { tab: "complete", icon: "≡", name: "Complete data" },
  { tab: "export", icon: "↓", name: "Export study" },
  { tab: "settings", icon: "⚙", name: "Case & settings" },
  { tab: "proof", icon: "▧", name: "Vision connection" },
];
const headings: Record<Tab, [string, string]> = {
  operate: [
    "Operate a reviewed study.",
    "Inspect the network, change a simulated state, and trace every result.",
  ],
  upload: [
    "From drawing to a reviewable case.",
    "Files stay in this browser. Only explicitly selected vision requests leave it.",
  ],
  review: [
    "Check the drawing. Confirm the model.",
    "Select an element to link its original source, network connections and inputs.",
  ],
  validate: [
    "Find issues before a solve.",
    "Engineering rules, topology checks and native solver diagnostics.",
  ],
  complete: [
    "Make the engineering inputs explicit.",
    "Fill missing values, accept individual assumptions and confirm the reference source.",
  ],
  export: [
    "Take the case and solution with you.",
    "Every download includes the canonical inputs needed to reproduce this study.",
  ],
  settings: [
    "Your case. Your conventions.",
    "Adjust metadata, display preferences and validation thresholds.",
  ],
  proof: [
    "Test the vision connection.",
    "A synthetic image tests API connectivity. Extraction accuracy is measured separately.",
  ],
};
export default function App() {
  const w = useWorkspace();
  const { doc } = w;
  const [tab, setTab] = useState<Tab>("operate");
  const [sourceFocus, setSourceFocus] = useState<DrawingRef | null>(null);
  const [selected, setSelected] = useState("");
  const [theme, setTheme] = useState("dark");
  const [table, setTable] = useState("Buses");
  const [search, setSearch] = useState("");
  const [comparison, setComparison] = useState(false);
  const [newType, setNewType] = useState<ElementType>("busbar");
  const [newId, setNewId] = useState("");
  const [newPoint, setNewPoint] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [retypeConfirm, setRetypeConfirm] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const findings = useMemo(() => (doc ? validateNetwork(doc) : []), [doc]);
  const current = doc?.elements.find((e) => e.id === selected);
  const result =
    doc?.solution?.status === "converged" ? doc.solution.results : null;
  const select = (id: string) => {
    setSourceFocus(null);
    setSelected(id);
    setDeleteConfirm(false);
    setRetypeConfirm(null);
  };
  const apply = (next: StudyDocument) => w.replace(next);
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      w.setError(
        e instanceof Error ? e.message : "The change was not accepted.",
      );
    }
  };
  const edit = (path: string, value: JsonValue) => {
    if (doc) attempt(() => apply(updateInput(doc, path, value)));
  };
  const operateSelected = async (
    path: string,
    value: JsonValue,
    kind: "switch" | "setpoint" | "tap" | "service",
    message: string,
  ) => {
    if (!doc || !current) return;
    const started = performance.now();
    try {
      const next = await operate(doc, current.id, path, value, kind, message);
      if (w.ref.current !== doc) return;
      apply(next);
      await w.solve(next, started);
    } catch (e) {
      w.setError(e instanceof Error ? e.message : "The operation failed.");
    }
  };
  const review = async () => {
    if (!doc) return;
    try {
      let next = commitEngineeringEdit(doc, (d) => {
        for (const e of d.elements) {
          e.review = {
            status: "confirmed",
            reviewed_revision: doc.revision + 1,
            reviewed_at: new Date().toISOString(),
          };
          const mark = (v: unknown) => {
            if (!v || typeof v !== "object") return;
            if ("provenance" in v) {
              const p = (
                v as { provenance: { source: string; reviewed?: boolean } }
              ).provenance;
              if (p.source === "drawing") p.reviewed = true;
            }
            Object.values(v).forEach(mark);
          };
          mark(e);
        }
        d.review.unresolved_element_ids = [];
      });
      next = await confirmReview(next);
      if (w.ref.current !== doc) return;
      apply(next);
      setTab("validate");
      await w.validate(next);
    } catch (e) {
      w.setError(
        e instanceof Error ? e.message : "Review could not be confirmed.",
      );
    }
  };
  const acknowledge = (f: Finding) => {
    if (!doc) return;
    const next = structuredClone(doc);
    next.operation.acknowledgements.push({
      finding_id: f.id,
      finding_fingerprint: `${f.rule_id}:${f.element_ids.join(",")}:${f.message}`,
      acknowledged_at: new Date().toISOString(),
      acknowledged_revision: doc.revision,
    });
    w.replace(next, true);
  };
  const proof =
    doc?.solution && w.reference
      ? compareWithReference(doc.solution, w.reference)
      : null;
  const tables = doc && result ? solutionTables(doc) : [];
  const navElements =
    doc?.elements.filter((e) =>
      `${e.id} ${nameOf(e)}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const inspector = doc ? (
    <Inspector
      key={selected}
      doc={doc}
      element={current}
      onEdit={edit}
      onOperate={(...args) => void operateSelected(...args)}
      onDelete={() => setDeleteConfirm(true)}
      onRetype={setRetypeConfirm}
      onReconnect={(role, point) =>
        attempt(() =>
          apply(reconnectTerminal(doc, selected, role, point || null)),
        )
      }
    />
  ) : null;
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setTab("operate")}>
          <span className="brand-icon">⌁</span>
          <span>
            SLD <strong>Power Flow</strong>
          </span>
        </a>
        <span className="version">SIMULATED AC STUDIES</span>
        <div className="top-actions">
          <span className="study-badge">◇ STUDY MODE</span>
          <button
            className="icon-button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☼" : "◐"}
          </button>
          <a
            className="github-link"
            href="https://github.com/divyanshchaudhary85/sld-power-flow"
            target="_blank"
            rel="noreferrer"
          >
            Source ↗
          </a>
        </div>
      </header>
      <div className="desktop-note">
        Designed for a desktop browser at least 1280 px wide.
      </div>
      <div className="layout">
        <aside className="sidebar">
          <div className="section-label">WORKSPACE</div>
          <nav aria-label="Workspace">
            {navigation.map((n) => (
              <button
                key={n.tab}
                className={tab === n.tab ? "nav active" : "nav"}
                onClick={() => setTab(n.tab)}
              >
                <span>{n.icon}</span>
                {n.name}
              </button>
            ))}
          </nav>
          <div className="section-label samples-label">REFERENCE CASES</div>
          {[
            ["case9", "09", "IEEE 9-bus"],
            ["case14", "14", "IEEE 14-bus"],
            ["case9-breaker", "CB", "Breaker isolation"],
            ["case50", "50", "50-bus study"],
          ].map(([id, n, label]) => (
            <button
              key={id}
              className={`case ${doc?.meta.fixture_id === id ? "active-case" : ""}`}
              onClick={() => {
                void w.loadSample(id);
                setSelected("");
                setTab("operate");
              }}
            >
              <span className="case-number">{n}</span>
              <span>
                <strong>{label}</strong>
                <small>Synthetic / reference sample</small>
              </span>
            </button>
          ))}
          <button className="load-case" onClick={() => picker.current?.click()}>
            ＋ Open canonical JSON
          </button>
          <input
            ref={picker}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void w.importCase(file);
                setTab("review");
                setSelected("");
              }
              e.target.value = "";
            }}
          />
          <button
            className="load-case"
            onClick={() => {
              apply(createDraft());
              setSelected("");
              setTab("settings");
            }}
          >
            ＋ New blank study
          </button>
          <div className="sidebar-bottom">
            <span className="section-label">BUILT FOR TRACEABILITY</span>
            <p>
              Inputs have provenance.
              <br />
              Results come from the solver.
            </p>
            <small>{w.saveStatus}</small>
            <div className="local-indicator">◉ Browser-local calculations</div>
            <small>
              Vision requests send selected image tiles directly to OpenAI with
              your own key.
            </small>
          </div>
        </aside>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {tab === "operate"
                  ? "POWER SYSTEM WORKSPACE"
                  : "TRACEABLE STUDY PIPELINE"}
              </div>
              <h1>{headings[tab][0]}</h1>
              <p>{headings[tab][1]}</p>
            </div>
            <span className="phase-pill">Up to 50 electrical buses</span>
          </div>
          <div className="scope-note">
            <span>ⓘ</span>
            <span>
              Balanced positive-sequence study only.{" "}
              {known(doc?.meta.network_type) === "distribution"
                ? "Phase unbalance is not modelled. "
                : ""}
              No short-circuit, protection, dynamics or equipment control.
              Extraction needs human review; real-world accuracy is unverified.
            </span>
          </div>
          {w.error && (
            <div className="error-box" role="alert">
              <strong>Action not completed</strong>
              <p>{w.error}</p>
              <button onClick={() => w.setError("")}>Dismiss</button>
            </div>
          )}
          {!w.runtime && (
            <div className="engine-strip" role="status">
              <span>
                {w.progress?.message ?? "Preparing the local numerical engine…"}
              </span>
              <progress
                value={w.progress?.completed}
                max={w.progress?.total ?? 1}
              />
              <button onClick={() => void w.initialize()}>Retry engine</button>
            </div>
          )}
          {doc && (
            <div className="case-toolbar">
              <div>
                <span className="sample-badge">
                  {known(doc.meta.case_origin) === "sample"
                    ? "SAMPLE"
                    : "LOCAL CASE"}
                </span>
                <h2>{known(doc.meta.name)}</h2>
                <span className="subtle">
                  {known(doc.meta.frequency_hz) ?? "—"} Hz ·{" "}
                  {known(doc.meta.base_mva) ?? "—"} MVA · rev {doc.revision} ·{" "}
                  {doc.review.status === "confirmed"
                    ? "Reviewed"
                    : "Review required"}
                </span>
              </div>
              <div className="button-row">
                <button
                  onClick={() =>
                    download(
                      "canonical-case.json",
                      JSON.stringify(doc, null, 2),
                    )
                  }
                >
                  Save case
                </button>
                <button
                  className="primary"
                  disabled={w.busy || w.loading || !w.runtime}
                  onClick={() => void w.solve()}
                >
                  {w.busy ? "Solving…" : "▶ Solve in browser"}
                </button>
                {w.busy && (
                  <button
                    onClick={() => {
                      w.adapter.cancel();
                      w.setRuntime(null);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
          {w.loading && !doc && <Loading />}
          {doc && tab === "operate" && (
            <>
              <div className="metrics">
                <Metric
                  title="SOLVE STATUS"
                  text={
                    w.busy ? "Solving" : (doc.solution?.status ?? "Not solved")
                  }
                  unit={
                    doc.solution?.iterations != null
                      ? `${doc.solution.iterations} iterations`
                      : "Newton–Raphson AC"
                  }
                />
                <Metric
                  title="GENERATION"
                  text={format(result?.system.total_generation_mw)}
                  unit="MW"
                />
                <Metric
                  title="SERVED / UNSERVED LOAD"
                  text={`${format(result?.system.total_served_load_mw)} / ${format(result?.system.total_unserved_load_mw)}`}
                  unit="MW"
                />
                <Metric
                  title="ACTIVE LOSSES"
                  text={format(result?.system.total_loss_mw)}
                  unit="MW"
                />
              </div>
              <div className="console-grid">
                <section className="panel navigator">
                  <div className="panel-header">
                    <h3>Network</h3>
                  </div>
                  <input
                    aria-label="Find equipment"
                    placeholder="Find ID or label"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Navigator
                    doc={doc}
                    elements={navElements}
                    selected={selected}
                    onSelect={select}
                  />
                </section>
                <section className="panel diagram-panel">
                  <div className="panel-header">
                    <h3>One-line diagram</h3>
                    <div className="button-row">
                      <button onClick={() => setComparison((v) => !v)}>
                        Compare base
                      </button>
                      <button
                        disabled={!doc.operation.base_snapshot || w.busy}
                        onClick={() => {
                          void resetBase(doc)
                            .then((next) => {
                              if (w.ref.current !== doc) return;
                              apply(next);
                              return w.solve(next);
                            })
                            .catch((e) => w.setError(String(e)));
                        }}
                      >
                        Reset to base
                      </button>
                    </div>
                  </div>
                  <Diagram
                    doc={doc}
                    selected={selected}
                    onSelect={select}
                    findings={findings}
                  />
                  <div className="table-foot">
                    <span>
                      {w.runtime
                        ? `pandapower ${w.runtime.solverVersion} · initialization ${(w.runtime.loadMs / 1000).toFixed(2)} s`
                        : "Engine loading"}
                    </span>
                    <span>
                      {w.elapsed !== null
                        ? `${(w.elapsed / 1000).toFixed(3)} s solve + redraw`
                        : "No current timing"}
                    </span>
                  </div>
                </section>
                {inspector}
              </div>
              {comparison && (
                <DataGrid
                  table={{
                    name: "Changes from base inputs",
                    rows: baseDifferences(doc),
                  }}
                />
              )}
              {proof && (
                <div className="reference-strip">
                  {proof.passed ? "✓ Reference pass" : "△ Reference failed"} ·
                  maximum voltage difference{" "}
                  {proof.maxError?.toExponential(3) ?? "unavailable"} pu ·
                  threshold 1e-6 pu · all {proof.rows.length} buses
                </div>
              )}
              <Findings
                doc={doc}
                findings={findings}
                onSelect={select}
                onAcknowledge={acknowledge}
              />
              <div className="results-tabs tabs">
                {[
                  "Buses",
                  "Branches",
                  "Transformers",
                  "Generators",
                  "Loads",
                  "Events",
                ].map((t) => (
                  <button
                    key={t}
                    className={table === t ? "selected" : ""}
                    onClick={() => setTable(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {table === "Events" ? (
                <DataGrid
                  table={{
                    name: "Events",
                    rows: doc.operation.events.map((e) => ({
                      time: e.time,
                      kind: e.kind,
                      elements: e.selected_element_ids.join("; "),
                      message: e.message,
                      outcome: e.outcome,
                      revision: e.new_revision,
                    })),
                  }}
                />
              ) : result ? (
                <DataGrid
                  key={table}
                  table={tables.find((t) => t.name === table)!}
                  onSelect={select}
                />
              ) : (
                <div className="panel empty-state">
                  <h3>No current solved values</h3>
                  <p>
                    Review the case, resolve blocking findings, then run the
                    numerical solver.
                  </p>
                </div>
              )}
            </>
          )}
          {tab === "upload" && (
            <Suspense fallback={<Loading />}>
              <Upload
                onComplete={(next) => {
                  apply(next);
                  setSelected("");
                  setTab("review");
                }}
                onError={w.setError}
              />
            </Suspense>
          )}
          {doc && tab === "review" && (
            <>
              <div className="review-actions">
                <span>
                  {doc.elements.length} elements ·{" "}
                  {doc.connectivity_points.length} connectivity points
                </span>
                <button className="primary" onClick={() => void review()}>
                  I reviewed this model — confirm
                </button>
              </div>
              <div className="review-grid">
                <Suspense fallback={<Loading />}>
                  <SourceDrawing
                    doc={doc}
                    focus={sourceFocus}
                    selected={selected}
                    onSelect={select}
                    findings={findings}
                  />
                </Suspense>
                <section className="panel">
                  <div className="panel-header">
                    <h3>Reconstructed network</h3>
                  </div>
                  <Diagram
                    doc={doc}
                    selected={selected}
                    onSelect={select}
                    findings={findings}
                  />
                </section>
                {inspector}
              </div>
              <EndpointReview
                doc={doc}
                onChange={apply}
                onError={w.setError}
                onFocus={(source) => {
                  setSelected("");
                  setSourceFocus(source);
                }}
              />
              <section className="panel add-equipment">
                <h3>Add or reconnect equipment</h3>
                <div className="button-row">
                  <select
                    aria-label="New element type"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as ElementType)}
                  >
                    {ELEMENT_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <input
                    aria-label="New element ID"
                    value={newId}
                    placeholder="Unique element ID"
                    onChange={(e) => setNewId(e.target.value)}
                  />
                  <button
                    disabled={!newId.trim()}
                    onClick={() =>
                      attempt(() => {
                        apply(
                          commitEngineeringEdit(doc, (d) => {
                            d.elements.push(
                              createElement(newType, newId.trim(), d),
                            );
                          }),
                        );
                        select(newId.trim());
                        setNewId("");
                      })
                    }
                  >
                    Add element
                  </button>
                  <input
                    aria-label="New connectivity point ID"
                    placeholder="Connectivity point ID"
                    value={newPoint}
                    onChange={(e) => setNewPoint(e.target.value)}
                  />
                  <button
                    disabled={!newPoint.trim()}
                    onClick={() =>
                      attempt(() => {
                        apply(
                          commitEngineeringEdit(doc, (d) => {
                            d.connectivity_points.push({
                              id: newPoint.trim(),
                              position: { x: 400, y: 300 },
                              source_ref: {
                                kind: "user_added",
                                created_at: new Date().toISOString(),
                                manually_marked_region: null,
                              },
                              kind: "junction",
                              evidence: [],
                            });
                          }),
                        );
                        setNewPoint("");
                      })
                    }
                  >
                    Add connection point
                  </button>
                </div>
                <p className="small-note">
                  New equipment starts incomplete. Select it to set service
                  status, attributes and terminal connections.
                </p>
              </section>
              <Findings
                doc={doc}
                findings={findings.filter(
                  (f) => f.stage === "drawing" || f.stage === "topology",
                )}
                onSelect={select}
              />
            </>
          )}
          {doc && tab === "validate" && (
            <>
              <div className="review-actions">
                <p>
                  Warnings remain visible. Blocking findings prevent the solve.
                </p>
                <button onClick={() => void w.validate()}>Run rules</button>
                <button
                  disabled={!w.runtime}
                  onClick={() => {
                    void w.adapter
                      .diagnose(doc)
                      .then((extra) => w.validate(doc, extra))
                      .catch((e) => w.setError(String(e)));
                  }}
                >
                  Run native diagnostics
                </button>
              </div>
              <Findings
                doc={doc}
                findings={doc.validation?.findings ?? findings}
                onSelect={(id) => {
                  select(id);
                  setTab("review");
                }}
                onAcknowledge={acknowledge}
              />
            </>
          )}
          {doc && tab === "complete" && (
            <Completion doc={doc} onChange={apply} onError={w.setError} />
          )}
          {doc && tab === "export" && (
            <Suspense fallback={<Loading />}>
              <ExportPanel
                doc={doc}
                adapter={w.adapter}
                runtimeReady={!!w.runtime}
                onError={w.setError}
              />
            </Suspense>
          )}
          {doc && tab === "settings" && (
            <>
              <section className="panel settings-panel">
                <div className="panel-header">
                  <h3>Study metadata and display</h3>
                </div>
                <div className="completion-content">
                  <label className="stack-label">
                    Case name
                    <input
                      defaultValue={known(doc.meta.name)}
                      key={`${doc.case_id}-name`}
                      onBlur={(e) => {
                        if (e.target.value !== known(doc.meta.name))
                          edit("/meta/name", e.target.value);
                      }}
                    />
                  </label>
                  <label className="stack-label">
                    Network type
                    <select
                      value={known(doc.meta.network_type) ?? ""}
                      onChange={(e) =>
                        edit("/meta/network_type", e.target.value)
                      }
                    >
                      <option value="">Select network type</option>
                      <option value="transmission_subtransmission">
                        Transmission / sub-transmission
                      </option>
                      <option value="industrial">Industrial plant</option>
                      <option value="distribution">
                        Distribution feeder — balanced equivalent
                      </option>
                    </select>
                  </label>
                  <label className="stack-label">
                    Frequency
                    <select
                      value={known(doc.meta.frequency_hz) ?? ""}
                      onChange={(e) =>
                        edit("/meta/frequency_hz", Number(e.target.value))
                      }
                    >
                      <option value="">Select frequency</option>
                      <option value="50">50 Hz</option>
                      <option value="60">60 Hz</option>
                    </select>
                  </label>
                  <label className="stack-label">
                    Symbols
                    <select
                      value={known(doc.meta.symbol_set) ?? ""}
                      onChange={(e) => edit("/meta/symbol_set", e.target.value)}
                    >
                      <option value="">Choose symbols</option>
                      <option value="IEC">IEC</option>
                      <option value="ANSI_IEEE">ANSI / IEEE</option>
                    </select>
                  </label>
                  <label className="stack-label">
                    Breaker colour convention
                    <select
                      value={
                        doc.operation.display_preferences
                          .breaker_colour_convention
                      }
                      onChange={(e) => {
                        const next = structuredClone(doc);
                        next.operation.display_preferences.breaker_colour_convention =
                          e.target.value as
                            "shape_only" | "closed_red" | "closed_green";
                        w.replace(next, true);
                      }}
                    >
                      <option value="shape_only">Shape and text only</option>
                      <option value="closed_red">Closed red</option>
                      <option value="closed_green">Closed green</option>
                    </select>
                  </label>
                  <button onClick={() => setTab("complete")}>
                    Edit engineering settings and limits
                  </button>
                  <button
                    disabled={doc.review.status !== "confirmed"}
                    onClick={() => {
                      void captureBase(doc).then((next) => {
                        if (w.ref.current === doc) w.replace(next, true);
                      });
                    }}
                  >
                    Capture inputs as base case
                  </button>
                  <button
                    onClick={() =>
                      void diagramSVG(doc).then((svg) =>
                        download("synthetic-drawing.svg", svg, "image/svg+xml"),
                      )
                    }
                  >
                    Save synthetic SVG drawing
                  </button>
                </div>
              </section>
              <section className="panel contract">
                <div className="panel-header">
                  <h3>Canonical study document</h3>
                  <a
                    href={`${import.meta.env.BASE_URL}schema/study-document.schema.json`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    JSON Schema ↗
                  </a>
                </div>
                <pre>{JSON.stringify(doc, null, 2)}</pre>
              </section>
            </>
          )}
          {tab === "proof" && (
            <Suspense fallback={<Loading />}>
              <VisionProof />
            </Suspense>
          )}
          {deleteConfirm && current && doc && (
            <ConfirmDialog
              title={`Delete ${nameOf(current)}?`}
              confirmLabel="Delete element"
              onCancel={() => setDeleteConfirm(false)}
              onConfirm={() =>
                attempt(() => {
                  apply(removeElement(doc, current.id));
                  setSelected("");
                  setDeleteConfirm(false);
                })
              }
            >
              <p>Review connections and the reference source after deletion.</p>
            </ConfirmDialog>
          )}
          {retypeConfirm && current && doc && (
            <ConfirmDialog
              title={`Change ${nameOf(current)} to ${retypeConfirm}?`}
              confirmLabel="Change type"
              onCancel={() => setRetypeConfirm(null)}
              onConfirm={() =>
                attempt(() => {
                  apply(
                    commitEngineeringEdit(doc, (d) => {
                      d.elements[
                        d.elements.findIndex((e) => e.id === current.id)
                      ] = retypeElement(
                        current,
                        retypeConfirm as ElementType,
                        d,
                      );
                    }),
                  );
                  setRetypeConfirm(null);
                })
              }
            >
              <p>
                Its engineering fields and connections will require new review.
              </p>
            </ConfirmDialog>
          )}
          <footer className="page-footer">
            <span>SIMULATED STUDIES ONLY</span>
            <span>
              No analytics · No server-side case storage · No shipped API key
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Loading() {
  return (
    <div className="empty-state">
      <p>Loading this workspace…</p>
    </div>
  );
}
function Metric({
  title,
  text,
  unit,
}: {
  title: string;
  text: string;
  unit: string;
}) {
  return (
    <div className="metric">
      <span className="section-label">{title}</span>
      <strong>{text}</strong>
      <small>{unit}</small>
    </div>
  );
}
function Navigator({
  doc,
  elements,
  selected,
  onSelect,
}: {
  doc: StudyDocument;
  elements: StudyDocument["elements"];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const groups = new Map<string, StudyDocument["elements"]>();
  for (const e of elements) {
    const terminal = Object.values(e.terminals)[0];
    const bus = doc.elements.find(
      (b) =>
        b.type.value === "busbar" &&
        known(Object.values(b.terminals)[0]?.connection_point) ===
          known(terminal?.connection_point),
    );
    const kv =
      bus && "nominal_kv" in bus.data ? known(bus.data.nominal_kv) : undefined;
    const group = `${known(e.station) ?? "Network"} / ${kv ?? "—"} kV / ${known(e.bay) ?? "Main"}`;
    groups.set(group, [...(groups.get(group) ?? []), e]);
  }
  return (
    <div className="navigator-tree">
      {[...groups].map(([group, rows]) => (
        <details open key={group}>
          <summary>{group}</summary>
          {rows.map((e) => (
            <button
              key={e.id}
              className={e.id === selected ? "selected" : ""}
              onClick={() => onSelect(e.id)}
            >
              {nameOf(e)}
              <small>{e.type.value.replaceAll("_", " ")}</small>
            </button>
          ))}
        </details>
      ))}
    </div>
  );
}
