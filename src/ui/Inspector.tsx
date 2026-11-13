import { useState } from "react";
import type { Element, JsonValue, StudyDocument } from "../model";
import { inputFields, known, nameOf } from "./values";
import { ELEMENT_TYPES } from "../extraction/types";
import ConfirmDialog from "./ConfirmDialog";
export function ValueEditor({
  path,
  field,
  onSave,
}: {
  path: string;
  field: { status: string; value?: unknown; provenance?: { source: string } };
  onSave: (path: string, value: JsonValue) => void;
}) {
  const leaf = path.split("/").at(-1) ?? "";
  const choices: Record<string, string[]> = {
    network_type: [
      "transmission_subtransmission",
      "industrial",
      "distribution",
    ],
    symbol_set: ["IEC", "ANSI_IEEE"],
    state: ["open", "closed"],
    normal_state: ["open", "closed"],
    mode: ["slack", "pv", "voltage_controlled"],
    model: ["constant_pq", "constant_impedance"],
    electrical_model: ["ideal"],
    reactive_kind: ["lagging", "leading"],
    technology: ["pv", "storage", "capacitor", "reactor", "other"],
    side: ["hv", "lv"],
    changer_type: ["ratio", "phase_shift"],
    case_origin: ["manual", "uploaded", "sample"],
  };
  const bool =
    typeof field.value === "boolean" ||
    [
      "in_service",
      "slack_confirmed",
      "base_confirmed",
      "enforce_q_limits",
      "allow_slack_export",
    ].includes(leaf);
  const text =
    typeof field.value === "string" ||
    [
      "name",
      "label",
      "station",
      "bay",
      "notes",
      "description",
      "ratio_definition",
      "slack_element_id",
      "connection_point",
      "raw_symbol_description",
      "raw_label",
    ].includes(leaf);
  const complex =
    leaf === "tap" ||
    leaf === "standard_type" ||
    (field.value !== null && typeof field.value === "object");
  const [value, setValue] = useState(
    field.status === "known" && field.value !== null
      ? complex
        ? JSON.stringify(field.value)
        : String(field.value)
      : "",
  );
  const [error, setError] = useState("");
  const save = (explicit?: JsonValue) => {
    try {
      let parsed: JsonValue;
      if (explicit !== undefined) parsed = explicit;
      else if (bool) parsed = value === "true";
      else if (choices[leaf] || text) parsed = value;
      else if (complex) parsed = JSON.parse(value);
      else {
        if (value.trim() === "" || !Number.isFinite(Number(value)))
          throw new Error("Enter a finite number.");
        parsed = Number(value);
      }
      onSave(path, parsed);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enter a valid value.");
    }
  };
  const title = leaf.replaceAll("_", " ");
  const options = bool ? ["true", "false"] : choices[leaf];
  if (leaf === "tap")
    return (
      <div className="input-field">
        <label>
          Tap changer
          <select
            aria-label="Tap capability"
            value={
              field.value &&
              typeof field.value === "object" &&
              "kind" in field.value
                ? String(field.value.kind)
                : ""
            }
            onChange={(e) => {
              if (e.target.value === "none") save({ kind: "none" });
              else if (e.target.value === "fixed") {
                const missing = () => ({
                  status: "missing",
                  reason: "not_entered",
                  candidates: [],
                  evidence: [],
                });
                const tap: Record<string, JsonValue> = { kind: "fixed" };
                for (const name of [
                  "side",
                  "neutral",
                  "min",
                  "max",
                  "position",
                  "step_percent",
                  "step_degree",
                  "changer_type",
                  "ratio_definition",
                ])
                  tap[name] = missing();
                save(tap);
              }
            }}
          >
            <option value="">Choose capability</option>
            <option value="none">No tap changer</option>
            <option value="fixed">Fixed-position tap changer</option>
          </select>
        </label>
        <small>{field.provenance?.source ?? "Missing input"}</small>
        {error && <small role="alert">{error}</small>}
      </div>
    );
  return (
    <div className="input-field">
      <label>
        {title}
        {options ? (
          <select
            aria-label={title}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">Choose a value</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o === "true"
                  ? "Yes"
                  : o === "false"
                    ? "No"
                    : o.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={text || complex ? "text" : "number"}
            step="any"
            aria-label={title}
            value={value}
            placeholder={
              field.value === null ? "Not applicable" : "Enter value"
            }
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
        )}
      </label>
      <button disabled={value === ""} onClick={() => save()}>
        Apply
      </button>
      <small className={field.status === "missing" ? "missing" : ""}>
        {field.status === "missing"
          ? "Missing input"
          : (field.provenance?.source ?? "input")}
      </small>
      <button
        className="text-button"
        onClick={() => save(leaf === "tap" ? { kind: "none" } : null)}
      >
        {leaf === "tap" ? "No tap changer" : "Not applicable"}
      </button>
      {error && (
        <small role="alert" className="error-text">
          {error}
        </small>
      )}
    </div>
  );
}
export default function Inspector({
  doc,
  element,
  onEdit,
  onOperate,
  onDelete,
  onRetype,
  onReconnect,
}: {
  doc: StudyDocument;
  element?: Element;
  onEdit: (path: string, value: JsonValue) => void;
  onOperate: (
    path: string,
    value: JsonValue,
    kind: "switch" | "setpoint" | "tap" | "service",
    message: string,
  ) => void;
  onDelete: () => void;
  onRetype: (type: string) => void;
  onReconnect: (role: string, point: string) => void;
}) {
  const [section, setSection] = useState("inputs");
  const [pending, setPending] = useState<{
    path: string;
    value: JsonValue;
    kind: "switch" | "setpoint" | "tap" | "service";
    message: string;
  } | null>(null);
  const [opValue, setOpValue] = useState("");
  const [opField, setOpField] = useState("p_mw");
  if (!element)
    return (
      <aside className="panel inspector">
        <div className="panel-header">
          <h3>Inspector</h3>
        </div>
        <div className="empty-state">
          <h3>Select equipment</h3>
          <p>
            Select a symbol, table row or finding to inspect its inputs, source
            and results.
          </p>
        </div>
      </aside>
    );
  const index = doc.elements.findIndex((e) => e.id === element.id);
  const prefix = `/elements/${index}`;
  const kind = element.type.value;
  const data = element.data as Record<
    string,
    { status: string; value?: JsonValue }
  >;
  const isSwitch = ["circuit_breaker", "disconnector", "fuse"].includes(kind);
  const eligible = doc.review.status === "confirmed";
  const opPath = ["load", "motor", "generator", "static_generator"].includes(
    kind,
  )
    ? `${prefix}/data/${opField}`
    : kind === "transformer_2w" &&
        data.tap?.value &&
        typeof data.tap.value === "object" &&
        "kind" in data.tap.value &&
        data.tap.value.kind === "fixed"
      ? `${prefix}/data/tap/value/position`
      : null;
  const run = doc.solution?.status === "converged" ? doc.solution : null;
  const result = run?.results;
  const ownResults = result
    ? [
        ...result.buses.filter((b) => b.busbar_ids.includes(element.id)),
        ...result.lines.filter((b) => b.element_id === element.id),
        ...result.transformers.filter((b) => b.element_id === element.id),
        ...result.generators.filter((b) => b.element_id === element.id),
        ...result.external_grids.filter((b) => b.element_id === element.id),
        ...result.loads.filter((b) => b.element_id === element.id),
        ...result.shunts.filter((b) => b.element_id === element.id),
      ]
    : [];
  return (
    <aside className="panel inspector">
      <div className="panel-header">
        <div>
          <h3>{nameOf(element)}</h3>
          <small>
            {element.id} · {kind.replaceAll("_", " ")}
          </small>
        </div>
        <span className="sample-badge">
          {known(element.in_service) === false ? "OUT" : "IN SERVICE"}
        </span>
      </div>
      <div className="tabs inspector-tabs">
        {["inputs", "operate", "source", "results"].map((t) => (
          <button
            key={t}
            className={section === t ? "selected" : ""}
            onClick={() => {
              setSection(t);
              setPending(null);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {section === "inputs" && (
          <>
            <p className="small-note">
              Applying an input records it as user-supplied and requires review
              again. Select “Not applicable” only where the model permits it.
            </p>
            <ValueEditor
              key={`${doc.revision}-service`}
              path={`${prefix}/in_service`}
              field={element.in_service}
              onSave={onEdit}
            />
            <ValueEditor
              key={`${doc.revision}-label`}
              path={`${prefix}/label`}
              field={element.label}
              onSave={onEdit}
            />
            {["station", "bay", "notes"].map((key) => (
              <ValueEditor
                key={`${doc.revision}-${key}`}
                path={`${prefix}/${key}`}
                field={element[key as "station" | "bay" | "notes"]}
                onSave={onEdit}
              />
            ))}
            <label className="stack-label">
              Equipment type
              <select value={kind} onChange={(e) => onRetype(e.target.value)}>
                {ELEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            {Object.entries(element.terminals).map(([role, t]) => (
              <label className="stack-label" key={role}>
                {role} terminal
                <select
                  value={known(t.connection_point) ?? ""}
                  onChange={(e) => onReconnect(role, e.target.value)}
                >
                  <option value="">Unconnected</option>
                  {doc.connectivity_points.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {inputFields(element.data, `${prefix}/data`).map((row) => (
              <ValueEditor
                key={`${doc.revision}${row.path}`}
                {...row}
                onSave={onEdit}
              />
            ))}
            <button onClick={onDelete}>Delete selected element</button>
          </>
        )}
        {section === "operate" && (
          <>
            <p className="small-note">
              Every confirmed operation records an event and re-solves. Newly
              isolated equipment remains visible and unserved demand is
              reported.
            </p>
            {!eligible && <p>Review and confirm this model first.</p>}
            {isSwitch && (
              <button
                disabled={!eligible}
                onClick={() => {
                  const value =
                    known(data.state) === "closed" ? "open" : "closed";
                  setPending({
                    path: `${prefix}/data/state`,
                    value,
                    kind: "switch",
                    message: `${value === "open" ? "Open" : "Close"} ${nameOf(element)}`,
                  });
                }}
              >
                Select {known(data.state) === "closed" ? "open" : "close"}
              </button>
            )}
            {kind !== "busbar" && (
              <button
                disabled={!eligible}
                onClick={() =>
                  setPending({
                    path: `${prefix}/in_service`,
                    value: known(element.in_service) === false,
                    kind: "service",
                    message: `${known(element.in_service) === false ? "Return to" : "Take out of"} service: ${nameOf(element)}`,
                  })
                }
              >
                Select{" "}
                {known(element.in_service) === false
                  ? "return to service"
                  : "out of service"}
              </button>
            )}
            {opPath && (
              <label className="stack-label">
                {kind === "transformer_2w" ? (
                  "Fixed tap position"
                ) : (
                  <select
                    aria-label="Operating setpoint"
                    value={opField}
                    onChange={(e) => {
                      setOpField(e.target.value);
                      setOpValue("");
                    }}
                  >
                    <option value="p_mw">Active power · MW</option>
                    {kind === "generator" ? (
                      <option value="voltage_setpoint_kv">
                        Voltage setpoint · kV
                      </option>
                    ) : (
                      <option value="q_mvar">Reactive power · MVAr</option>
                    )}
                  </select>
                )}
                <input
                  type="number"
                  value={opValue}
                  onChange={(e) => setOpValue(e.target.value)}
                />
                <button
                  disabled={
                    !eligible ||
                    opValue.trim() === "" ||
                    !Number.isFinite(Number(opValue))
                  }
                  onClick={() =>
                    setPending({
                      path: opPath,
                      value: Number(opValue),
                      kind: kind === "transformer_2w" ? "tap" : "setpoint",
                      message: `Change ${nameOf(element)} ${kind === "transformer_2w" ? "tap" : opField} to ${opValue}`,
                    })
                  }
                >
                  Select change
                </button>
              </label>
            )}
            {pending && (
              <ConfirmDialog
                title={pending.message}
                confirmLabel="Confirm and re-solve"
                onCancel={() => setPending(null)}
                onConfirm={() => {
                  onOperate(
                    pending.path,
                    pending.value,
                    pending.kind,
                    pending.message,
                  );
                  setPending(null);
                }}
              >
                <p>This changes only the simulated study.</p>
              </ConfirmDialog>
            )}
          </>
        )}
        {section === "source" && (
          <>
            <h3>Original evidence</h3>
            <pre>{JSON.stringify(element.source_ref, null, 2)}</pre>
            <h3>Input provenance</h3>
            <pre>
              {JSON.stringify(
                inputFields(element).map((x) => ({ path: x.path, ...x.field })),
                null,
                2,
              )}
            </pre>
          </>
        )}
        {section === "results" &&
          (ownResults.length ? (
            <pre>{JSON.stringify(ownResults, null, 2)}</pre>
          ) : (
            <p>
              No current numerical result for this element. Switching states and
              de-energization remain topology data.
            </p>
          ))}
      </div>
    </aside>
  );
}
