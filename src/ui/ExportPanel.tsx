import { useState } from "react";
import type { StudyDocument, ExportRecord } from "../model";
import type { BrowserSolverAdapter } from "../solver/client";
import type { CaseFormat } from "../solver/protocol";
import { solutionTables, toCSV } from "../exports/tables";
import { workbookBytes, reportBytes } from "../exports/files";
import { diagramPNG } from "./diagram";
import { download } from "./values";
const choices = [
  ["all", "Complete study bundle"],
  ["pandapower-json", "pandapower JSON"],
  ["matpower", "MATPOWER .mat"],
  ["psse-raw", "PSS/E RAW v33"],
  ["xlsx", "Solution workbook .xlsx"],
  ["csv", "Solution CSV tables"],
  ["pdf", "PDF report"],
] as const;
export default function ExportPanel({
  doc,
  adapter,
  runtimeReady,
  onError,
}: {
  doc: StudyDocument;
  adapter: BrowserSolverAdapter;
  runtimeReady: boolean;
  onError: (message: string) => void;
}) {
  const [choice, setChoice] = useState("all");
  const [busy, setBusy] = useState("");
  const [receipt, setReceipt] = useState("");
  const solved =
    doc.solution?.status === "converged" &&
    doc.solution.model_revision === doc.revision;
  const start = async () => {
    setBusy("Preparing canonical case…");
    setReceipt("");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const snapshot = structuredClone(doc);
      const formats =
        choice === "all" ? choices.slice(1).map((c) => c[0]) : [choice];
      const warnings: string[] = [];
      for (const format of formats) {
        setBusy(`Writing ${format}…`);
        let recordFormat: ExportRecord["format"] = "canonical_json";
        if (["pandapower-json", "matpower", "psse-raw"].includes(format)) {
          const result = await adapter.exportCase(
            snapshot,
            format as CaseFormat,
          );
          zip.file(result.filename, result.data, {
            base64: result.encoding === "base64",
          });
          warnings.push(...result.warnings);
          recordFormat =
            format === "pandapower-json"
              ? "pandapower_json"
              : format === "matpower"
                ? "matpower_mat"
                : "psse_raw_33";
        } else if (format === "xlsx") {
          zip.file("solution.xlsx", await workbookBytes(snapshot));
          recordFormat = "xlsx";
        } else if (format === "csv") {
          for (const table of solutionTables(snapshot))
            zip.file(
              `tables/${table.name.toLowerCase()}.csv`,
              "\ufeff" + toCSV(table),
            );
          recordFormat = "csv";
        } else if (format === "pdf") {
          zip.file(
            "study-report.pdf",
            await reportBytes(snapshot, await diagramPNG(snapshot)),
          );
          recordFormat = "pdf";
        }
        snapshot.export_history.push({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          model_revision: snapshot.revision,
          solution_run_id: snapshot.solution?.id ?? null,
          format: recordFormat,
          exporter_version: "1.0.0",
          warnings: [...new Set(warnings)],
          round_trip_status:
            recordFormat === "xlsx" ||
            recordFormat === "csv" ||
            recordFormat === "pdf"
              ? "not_applicable"
              : "not_run",
          max_voltage_delta_pu: null,
          independent_reader: null,
        });
      }
      zip.file("canonical-case.json", JSON.stringify(snapshot, null, 2));
      zip.file(
        "README.txt",
        `SLD Power Flow — simulated study\nCase revision: ${snapshot.revision}\nInput hash: ${snapshot.solution?.input_hash ?? snapshot.review.confirmed_input_hash ?? "unconfirmed"}\nBalanced positive-sequence AC only.\n\nCanonical JSON retains explicit switching, provenance and source references. Interchange files are reduced bus-branch models. External source image bytes are not included.\nPer-case roundtrip status: not run; bundled fixture roundtrips are covered by automated tests. PSS/E desktop validation remains a user check.\n\n${[...new Set(warnings)].join("\n")}`,
      );
      setBusy("Compressing download…");
      download(
        `sld-study-rev-${doc.revision}.zip`,
        await zip.generateAsync({ type: "blob" }),
        "application/zip",
      );
      setReceipt(
        `Created ${formats.length} export format(s), with canonical-case.json and conversion notes. ${[...new Set(warnings)].join(" ")}`,
      );
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : "Export failed. No completed bundle was produced.",
      );
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="panel export-panel">
      <div className="panel-header">
        <h3>Reproducible study files</h3>
        <span className="sample-badge">REV {doc.revision}</span>
      </div>
      <div className="completion-content">
        <p>
          Every ZIP contains the canonical case and conversion notes. Solution
          files require a current converged solve; native case formats require
          reviewed inputs.
        </p>
        <div className="export-options">
          {choices.map(([value, label]) => (
            <label className="export-option" key={value}>
              <input
                type="radio"
                name="export"
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <button
          className="primary"
          disabled={
            !!busy ||
            !runtimeReady ||
            doc.review.status !== "confirmed" ||
            (["all", "xlsx", "csv", "pdf"].includes(choice) && !solved)
          }
          onClick={() => void start()}
        >
          {busy || "Download study ZIP"}
        </button>
        {!solved && (
          <p>
            Run a converged study to enable solution tables, workbook and
            report.
          </p>
        )}
        {busy && <p role="status">{busy}</p>}
        {receipt && (
          <div className="confirmation" role="status">
            {receipt}
          </div>
        )}
        <p className="small-note">
          RAW v33 and MATPOWER convert the reduced bus-branch case. Controls and
          drawing metadata remain in canonical JSON. Roundtrip verification
          applies to the tested fixtures; exported cases still need review in
          the receiving tool.
        </p>
      </div>
    </section>
  );
}
