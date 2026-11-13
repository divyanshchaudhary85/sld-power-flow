import { useState } from "react";
import type { JsonValue, StudyDocument } from "../model";
import {
  listMissingData,
  suggestedDefaults,
  acceptSuggestion,
  STANDARD_TYPES,
  applyStandardType,
} from "../completion";
import { updateInput } from "../model/editing";
import { getAt, inputFields, known, nameOf } from "./values";
import { ValueEditor } from "./Inspector";
import { assumptionRows } from "../exports/tables";
import { DataGrid } from "./Tables";
export default function Completion({
  doc,
  onChange,
  onError,
}: {
  doc: StudyDocument;
  onChange: (d: StudyDocument) => void;
  onError: (e: string) => void;
}) {
  const [element, setElement] = useState("");
  const [standard, setStandard] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const missing = listMissingData(doc);
  const suggestions = suggestedDefaults(doc);
  const selected = doc.elements.find((e) => e.id === element);
  const attempt = (fn: () => StudyDocument) => {
    try {
      onChange(fn());
    } catch (e) {
      onError(e instanceof Error ? e.message : "Input not accepted.");
    }
  };
  const edit = (path: string, value: JsonValue) =>
    attempt(() => updateInput(doc, path, value));
  return (
    <div className="completion-stack">
      <section className="panel">
        <div className="panel-header">
          <h3>
            Engineering data{" "}
            <small>{missing.length} required values or confirmations</small>
          </h3>
          <button onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? "Hide" : "Edit"} all case settings
          </button>
        </div>
        <div className="completion-content">
          <p>
            Every accepted value keeps its origin. Defaults below are
            suggestions until you explicitly accept them. Numeric inputs use MW,
            MVAr, kV, kA and km.
          </p>
          <div className="completion-grid">
            {(showSettings
              ? inputFields({ meta: doc.meta, settings: doc.settings })
              : missing.map((m) => ({
                  path: m.path,
                  field: getAt(doc, m.path) as {
                    status: string;
                    value?: unknown;
                    provenance?: { source: string };
                  },
                }))
            ).map((row) => (
              <div key={`${doc.revision}-${row.path}`}>
                <code>{row.path}</code>
                <ValueEditor {...row} onSave={edit} />
                {suggestions
                  .filter((s) => s.target_path === row.path)
                  .map((s) => (
                    <div className="default-offer" key={s.id}>
                      <p>
                        Suggested default:{" "}
                        <strong>{JSON.stringify(s.candidate_value)}</strong>
                      </p>
                      <small>{s.rationale}</small>
                      <button
                        onClick={() => attempt(() => acceptSuggestion(doc, s))}
                      >
                        Accept this default
                      </button>
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <div className="confirmation-grid">
            <label className="stack-label">
              Reference source
              <select
                value={known(doc.settings.slack_element_id) ?? ""}
                onChange={(e) =>
                  edit("/settings/slack_element_id", e.target.value)
                }
              >
                <option value="">Choose a source</option>
                {doc.elements
                  .filter((e) =>
                    ["external_grid", "generator"].includes(e.type.value),
                  )
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {nameOf(e)}
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={!known(doc.settings.slack_element_id)}
              onClick={() => edit("/settings/slack_confirmed", true)}
            >
              Confirm reference source
            </button>
            <button
              disabled={!known(doc.meta.base_mva)}
              onClick={() => edit("/settings/base_confirmed", true)}
            >
              Confirm {known(doc.meta.base_mva) ?? "—"} MVA system base
            </button>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h3>Standard-type library</h3>
          <small>pandapower 3.3.3 · explicit acceptance</small>
        </div>
        <div className="completion-content">
          <p>
            Applying a type replaces its listed nameplate parameters. Enter
            length, loading and operating settings separately.
          </p>
          <div className="button-row">
            <select
              aria-label="Equipment for standard type"
              value={element}
              onChange={(e) => {
                setElement(e.target.value);
                setStandard("");
              }}
            >
              <option value="">Choose equipment</option>
              {doc.elements
                .filter((e) =>
                  ["line", "cable", "transformer_2w"].includes(e.type.value),
                )
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {nameOf(e)}
                  </option>
                ))}
            </select>
            <select
              aria-label="Standard type"
              value={standard}
              onChange={(e) => setStandard(e.target.value)}
            >
              <option value="">Choose library type</option>
              {STANDARD_TYPES.filter(
                (s) => selected && s.elementKinds.includes(selected.type.value),
              ).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              disabled={!element || !standard}
              onClick={() =>
                attempt(() => applyStandardType(doc, element, standard))
              }
            >
              Accept and apply type
            </button>
          </div>
          {standard && (
            <pre>
              {JSON.stringify(
                STANDARD_TYPES.find((s) => s.id === standard),
                null,
                2,
              )}
            </pre>
          )}
        </div>
      </section>
      <DataGrid
        table={{ name: "Assumptions register", rows: assumptionRows(doc) }}
      />
    </div>
  );
}
