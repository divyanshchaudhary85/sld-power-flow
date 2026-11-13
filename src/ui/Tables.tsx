import { useState } from "react";
import type { Finding, StudyDocument } from "../model";
import type { DataTable } from "../exports/tables";
import { toCSV } from "../exports/tables";
import { download } from "./values";
export function DataGrid({
  table,
  onSelect,
}: {
  table: DataTable;
  onSelect?: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({
    key: "",
    asc: true,
  });
  const columns = [...new Set(table.rows.flatMap(Object.keys))];
  const rows = table.rows
    .filter((r) =>
      JSON.stringify(r).toLowerCase().includes(filter.toLowerCase()),
    )
    .slice()
    .sort((a, b) => {
      const av = a[sort.key],
        bv = b[sort.key];
      return (
        (typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""))) *
        (sort.asc ? 1 : -1)
      );
    });
  return (
    <section className="panel data-grid">
      <div className="panel-header">
        <h3>
          {table.name} <small>{rows.length} records</small>
        </h3>
        <div className="button-row">
          <input
            aria-label={`Filter ${table.name}`}
            placeholder="Filter records"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            onClick={() =>
              download(
                `${table.name.toLowerCase()}.csv`,
                "\ufeff" + toCSV({ ...table, rows }),
                "text/csv;charset=utf-8",
              )
            }
          >
            CSV
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  aria-sort={
                    sort.key === c
                      ? sort.asc
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    className="sort-button"
                    onClick={() =>
                      setSort({
                        key: c,
                        asc: c === sort.key ? !sort.asc : true,
                      })
                    }
                  >
                    {c.replaceAll("_", " ")}{" "}
                    {sort.key === c ? (sort.asc ? "↑" : "↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                tabIndex={onSelect ? 0 : undefined}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const id =
                      r.element_id ?? String(r.busbar_ids ?? "").split(";")[0];
                    if (id) onSelect?.(String(id));
                  }
                }}
                onClick={() => {
                  const id =
                    r.element_id ?? String(r.busbar_ids ?? "").split(";")[0];
                  if (id) onSelect?.(String(id));
                }}
              >
                {columns.map((c) => (
                  <td key={c} title={String(r[c] ?? "unavailable")}>
                    {r[c] === null
                      ? "—"
                      : typeof r[c] === "number"
                        ? (r[c] as number).toLocaleString("en-US", {
                            maximumFractionDigits: 6,
                          })
                        : String(r[c] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty-state">
            <p>No matching records.</p>
          </div>
        )}
      </div>
    </section>
  );
}
export function Findings({
  doc,
  findings,
  onSelect,
  onAcknowledge,
}: {
  doc: StudyDocument;
  findings: Finding[];
  onSelect: (id: string) => void;
  onAcknowledge?: (f: Finding) => void;
}) {
  const [severity, setSeverity] = useState("all");
  const [filter, setFilter] = useState("");
  const [reverse, setReverse] = useState(false);
  const rows = findings.filter(
    (f) =>
      (severity === "all" || f.severity === severity) &&
      `${f.message} ${f.element_ids.join(" ")} ${f.rule_id}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const ranked = { error: 0, alarm: 1, warning: 2, info: 3 };
  rows.sort(
    (a, b) => (ranked[a.severity] - ranked[b.severity]) * (reverse ? -1 : 1),
  );
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>
          Findings and alarms{" "}
          <small>
            {findings.filter((f) => f.blocks_solve).length} blocking
          </small>
        </h3>
        <div className="button-row">
          <input
            aria-label="Filter findings"
            placeholder="Filter element or message"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            aria-label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            {["all", "error", "alarm", "warning", "info"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button onClick={() => setReverse((v) => !v)}>
            Sort severity {reverse ? "↑" : "↓"}
          </button>
        </div>
      </div>
      {!rows.length ? (
        <div className="empty-state">
          <h3>No matching findings</h3>
          <p>
            {findings.length
              ? "Adjust the filter to show other findings."
              : "The current rule checks are clear."}
          </p>
        </div>
      ) : (
        <div className="findings-list">
          {rows.map((f) => (
            <div key={f.id} className={`finding severity-${f.severity}`}>
              <button
                className="finding-main"
                onClick={() => f.element_ids[0] && onSelect(f.element_ids[0])}
              >
                <span className="severity-icon">
                  {f.severity === "warning"
                    ? "△"
                    : f.severity === "info"
                      ? "ⓘ"
                      : "⊗"}
                </span>
                <span>
                  <strong>
                    {f.severity.toUpperCase()} · {f.rule_id}{" "}
                    {f.blocks_solve ? "· blocks solve" : ""}
                  </strong>
                  <p>{f.message}</p>
                  <small>
                    {f.element_ids.join(", ")}{" "}
                    {f.observed_value
                      ? ` · ${f.observed_value.value} ${f.observed_value.unit}`
                      : ""}
                    {f.limit ? ` / limit ${f.limit.value} ${f.limit.unit}` : ""}
                  </small>
                  <p className="suggested-fix">{f.suggested_fix}</p>
                </span>
              </button>
              {onAcknowledge && (
                <button
                  disabled={doc.operation.acknowledgements.some(
                    (a) =>
                      a.finding_id === f.id &&
                      a.acknowledged_revision === doc.revision,
                  )}
                  onClick={() => onAcknowledge(f)}
                >
                  {doc.operation.acknowledgements.some(
                    (a) =>
                      a.finding_id === f.id &&
                      a.acknowledged_revision === doc.revision,
                  )
                    ? "Acknowledged"
                    : "Acknowledge"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
