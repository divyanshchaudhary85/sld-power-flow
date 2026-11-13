import { useState } from "react";
import type { DrawingRef, EndpointObservation, StudyDocument } from "../model";
import {
  annotateEndpoint,
  endpointPointCandidates,
  resolveEndpoint,
} from "../model/endpointReview";
import { nameOf } from "./values";

interface Props {
  doc: StudyDocument;
  onChange: (document: StudyDocument) => void;
  onError: (message: string) => void;
  onFocus?: (source: DrawingRef) => void;
}
function EndpointRow({
  doc,
  endpoint,
  onChange,
  onError,
  onFocus,
}: Props & { endpoint: EndpointObservation }) {
  const candidates = endpointPointCandidates(doc, endpoint.id);
  const [source, setSource] = useState(
    candidates.length === 1 ? candidates[0] : "",
  );
  const [mode, setMode] = useState<"terminal" | "point">("terminal");
  const [elementId, setElementId] = useState(""),
    [role, setRole] = useState(""),
    [pointId, setPointId] = useState(""),
    [reason, setReason] = useState("");
  const element = doc.elements.find((candidate) => candidate.id === elementId);
  const sourcePoints = candidates.length
    ? doc.connectivity_points.filter((point) => candidates.includes(point.id))
    : doc.connectivity_points;
  const apply = (operation: () => StudyDocument) => {
    try {
      onChange(operation());
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "The endpoint could not be corrected.",
      );
    }
  };
  return (
    <article
      className="completion-content"
      style={{ borderTop: "1px solid var(--line)" }}
    >
      <div className="button-row">
        <strong>{endpoint.id}</strong>
        <span>Page {endpoint.source_ref.page}</span>
        {onFocus && (
          <button onClick={() => onFocus(endpoint.source_ref)}>
            Show endpoint on drawing
          </button>
        )}
      </div>
      <p>
        Inspect this wire end, then explicitly attach its electrical net or
        classify the detected end as non-electrical. These corrections require
        model review again.
      </p>
      <div className="completion-grid">
        <label className="stack-label">
          Wire connection point
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">Choose the wire net</option>
            {sourcePoints.map((point) => (
              <option key={point.id} value={point.id}>
                {point.id}
              </option>
            ))}
          </select>
        </label>
        <label className="stack-label">
          Attach to
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as "terminal" | "point")
            }
          >
            <option value="terminal">Equipment terminal</option>
            <option value="point">Existing connection point</option>
          </select>
        </label>
        {mode === "terminal" ? (
          <>
            <label className="stack-label">
              Target equipment
              <select
                value={elementId}
                onChange={(event) => {
                  setElementId(event.target.value);
                  setRole("");
                }}
              >
                <option value="">Choose equipment</option>
                {doc.elements
                  .filter(
                    (candidate) => Object.keys(candidate.terminals).length,
                  )
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {nameOf(candidate)} ({candidate.id})
                    </option>
                  ))}
              </select>
            </label>
            <label className="stack-label">
              Target terminal
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="">Choose terminal</option>
                {Object.keys(element?.terminals ?? {}).map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className="stack-label">
            Target connection point
            <select
              value={pointId}
              onChange={(event) => setPointId(event.target.value)}
            >
              <option value="">Choose a point</option>
              {doc.connectivity_points.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.id}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!candidates.length && (
        <p className="small-note">
          No unique wire-to-net evidence remains. Select the wire net from the
          reviewed drawing; location alone does not connect crossings.
        </p>
      )}
      <p className="small-note">
        Connecting to a different existing net joins all terminals on those two
        nets. Confirm that the drawing shows an electrical connection.
      </p>
      <button
        disabled={
          !source || (mode === "terminal" ? !elementId || !role : !pointId)
        }
        onClick={() =>
          apply(() =>
            resolveEndpoint(
              doc,
              endpoint.id,
              mode === "terminal"
                ? { kind: "terminal", elementId, role }
                : { kind: "point", pointId },
              { sourcePointId: source },
            ),
          )
        }
      >
        Confirm electrical attachment
      </button>
      <details>
        <summary>This is not an electrical endpoint</summary>
        <label className="stack-label">
          Reason for annotation
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="For example: dimension leader, not a conductor"
          />
        </label>
        <button
          disabled={!reason.trim()}
          onClick={() =>
            apply(() => annotateEndpoint(doc, endpoint.id, reason))
          }
        >
          Confirm non-electrical annotation
        </button>
      </details>
    </article>
  );
}

export default function EndpointReview(props: Props) {
  const endpoints = props.doc.extraction.unresolved_endpoints;
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>
          Unresolved drawing endpoints <small>{endpoints.length}</small>
        </h3>
      </div>
      {endpoints.length ? (
        endpoints.map((endpoint) => (
          <EndpointRow
            key={`${props.doc.revision}:${endpoint.id}`}
            {...props}
            endpoint={endpoint}
          />
        ))
      ) : (
        <div className="completion-content">
          <p>No unresolved drawing endpoints remain.</p>
        </div>
      )}
    </section>
  );
}
