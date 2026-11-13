import type { ResultNumber, StudyDocument } from "../model";
import { elementName } from "../ui/values";
import { assumptionsRegister } from "../model/editing";
import { defaultDependent } from "../ui/resultQuality";
export type Cell = string | number | null;
export interface DataTable {
  name: string;
  rows: Record<string, Cell>[];
}
const number = (value: ResultNumber) =>
  value.status === "available" ? value.value : null;
function results(object: object): Record<string, Cell> {
  const row: Record<string, Cell> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value && typeof value === "object" && "status" in value) {
      row[key] = number(value);
      row[`${key}_status`] =
        value.status === "available" ? "available" : value.reason;
    } else if (Array.isArray(value)) row[key] = value.join("; ");
    else
      row[key] = typeof value === "boolean" ? String(value) : (value as Cell);
  }
  return row;
}
export function assumptionRows(doc: StudyDocument): Record<string, Cell>[] {
  return assumptionsRegister(doc).map((row) => ({
    path: row.path,
    value: JSON.stringify(row.value),
    source: row.source,
    provenance: JSON.stringify(row.provenance),
  }));
}
export function solutionTables(doc: StudyDocument): DataTable[] {
  if (
    doc.solution?.status !== "converged" ||
    doc.solution.model_revision !== doc.revision ||
    !doc.solution.results
  )
    throw new Error(
      "A current converged solution is required for solution exports.",
    );
  const r = doc.solution.results;
  const named = (items: { element_id: string }[], table: string) =>
    items.map((x, i) => ({
      label: elementName(doc, x.element_id),
      default_dependent: defaultDependent(doc, `/results/${table}/${i}`)
        ? "yes"
        : "no",
      ...results(x),
    }));
  return [
    {
      name: "Buses",
      rows: r.buses.map((x, i) => ({
        default_dependent: defaultDependent(doc, `/results/buses/${i}`)
          ? "yes"
          : "no",
        labels: x.busbar_ids.map((id) => elementName(doc, id)).join("; "),
        ...results(x),
      })),
    },
    { name: "Branches", rows: named(r.lines, "lines") },
    { name: "Transformers", rows: named(r.transformers, "transformers") },
    {
      name: "Generators",
      rows: [
        ...named(r.external_grids, "external_grids"),
        ...named(r.generators, "generators"),
      ],
    },
    { name: "Loads", rows: named(r.loads, "loads") },
    { name: "Shunts", rows: named(r.shunts, "shunts") },
    {
      name: "Summary",
      rows: [
        {
          case_id: doc.case_id,
          revision: doc.revision,
          input_hash: doc.solution.input_hash,
          solver: doc.solution.solver.backend,
          version: doc.solution.solver.backend_version,
          ...results(r.system),
        },
      ],
    },
    { name: "Assumptions", rows: assumptionRows(doc) },
    {
      name: "Findings",
      rows: (doc.validation?.findings ?? doc.solution.diagnostics).map((f) => ({
        id: f.rule_id,
        severity: f.severity,
        elements: f.element_ids.join("; "),
        message: f.message,
        suggested_fix: f.suggested_fix,
      })),
    },
  ];
}
export function toCSV(table: DataTable): string {
  const columns = [...new Set(table.rows.flatMap(Object.keys))];
  const quote = (value: Cell) => {
    let s = value === null ? "" : String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return (
    [
      columns.map(quote).join(","),
      ...table.rows.map((row) =>
        columns.map((c) => quote(row[c] ?? null)).join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
