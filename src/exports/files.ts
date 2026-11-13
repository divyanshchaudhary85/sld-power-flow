import type { StudyDocument } from "../model";
import { solutionTables } from "./tables";
import { wrapText } from "./wrapText";
import { defaultDependent } from "../ui/resultQuality";
export async function workbookBytes(doc: StudyDocument): Promise<Uint8Array> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "SLD Power Flow";
  book.subject = "Balanced positive-sequence simulated study";
  book.created = new Date();
  for (const table of solutionTables(doc)) {
    const sheet = book.addWorksheet(table.name);
    const columns = [...new Set(table.rows.flatMap(Object.keys))];
    sheet.columns = columns.map((key) => ({
      header: key,
      key,
      width: Math.min(60, Math.max(18, key.length + 2)),
    }));
    sheet.addRows(table.rows);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    if (columns.length)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, table.rows.length + 1), column: columns.length },
      };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF243448" },
    };
    sheet.eachRow((row, index) => {
      if (index > 1)
        row.eachCell((cell) => {
          if (typeof cell.value === "number") cell.numFmt = "0.000000";
        });
    });
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}
export async function reportBytes(
  doc: StudyDocument,
  diagram: Uint8Array,
): Promise<Uint8Array> {
  solutionTables(doc); // Require a current converged result before writing any report.
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  const { assumptionsRegister } = await import("../model/editing");
  const { inputUnit } = await import("../completion/missing");
  const pdf = await PDFDocument.create();
  pdf.setTitle("SLD Power Flow study report");
  pdf.setSubject("Reviewed simulated balanced positive-sequence AC study");
  pdf.registerFontkit(fontkit);
  const fontResponse = await fetch(
    `${import.meta.env.BASE_URL}fonts/Inter-Regular.ttf`,
  );
  if (!fontResponse.ok) throw new Error("The report font could not load.");
  const font = await pdf.embedFont(await fontResponse.arrayBuffer(), {
    subset: true,
  });
  const run = doc.solution!,
    result = run.results!;
  const caseName =
    doc.meta.name.status === "known" ? doc.meta.name.value : doc.case_id;
  const ink = rgb(0.1, 0.15, 0.21),
    muted = rgb(0.34, 0.4, 0.47),
    rule = rgb(0.82, 0.85, 0.88),
    pale = rgb(0.95, 0.96, 0.97),
    accent = rgb(0.14, 0.23, 0.32);
  const margin = 34,
    width = 774,
    bottom = 42;
  let page = pdf.addPage([842, 595]),
    y = 550;
  const cache = new Map<string, number>();
  const measure = (text: string, size: number) => {
    const key = `${size}:${text}`;
    let value = cache.get(key);
    if (value === undefined) {
      value = font.widthOfTextAtSize(text, size);
      cache.set(key, value);
    }
    return value;
  };
  const clean = (text: string) => text.replace(/[\x00-\x08\x0e-\x1f]/g, "");
  const lines = (text: string, size: number, max: number) =>
    wrapText(clean(text), (value) => measure(value, size), max);
  const draw = (
    text: string,
    x: number,
    baseline: number,
    size = 9,
    color = ink,
  ) => page.drawText(clean(text), { x, y: baseline, size, font, color });
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const nextPage = (title: string) => {
    page = pdf.addPage([842, 595]);
    draw("SLD POWER FLOW  /  STUDY REPORT", margin, 566, 8, muted);
    draw(title, margin, 537, 17);
    page.drawLine({
      start: { x: margin, y: 522 },
      end: { x: 808, y: 522 },
      thickness: 0.8,
      color: rule,
    });
    y = 504;
  };
  const paragraph = (text: string, size = 9) => {
    for (const line of lines(text, size, width)) {
      if (y < bottom + 14) nextPage("Study notes - continued");
      draw(line, margin, y, size, muted);
      y -= size + 4;
    }
    y -= 7;
  };
  const n = (
    field: import("../model").ResultNumber | undefined,
    digits = 3,
  ): string =>
    !field || field.status !== "available"
      ? "unavailable"
      : (Math.abs(field.value) < 0.5 * 10 ** -digits ? 0 : field.value).toFixed(
          digits,
        );
  const name = (id: string) => {
    const element = doc.elements.find((item) => item.id === id);
    const label = element?.label.status === "known" ? element.label.value : id;
    return label === id ? id : `${label} [${id}]`;
  };
  const marked = (label: string, path: string) =>
    `${label}${defaultDependent(doc, path) ? " *" : ""}`;
  const equipmentName = (id: string) => {
    for (const key of [
      "external_grids",
      "generators",
      "loads",
      "shunts",
      "lines",
      "transformers",
    ] as const) {
      const index = result[key].findIndex((item) => item.element_id === id);
      if (index >= 0) return marked(name(id), `/results/${key}/${index}`);
    }
    return name(id);
  };
  type Column = { label: string; width: number; right?: boolean };
  const table = async (
    title: string,
    columns: Column[],
    rows: string[][],
    note = "",
  ) => {
    if (y < bottom + 90) nextPage(title);
    else {
      draw(title, margin, y, 12);
      y -= 22;
    }
    if (note) paragraph(note, 8);
    const head = () => {
      const headerLines = columns.map((column) =>
        lines(column.label, 7.5, column.width - 10),
      );
      const height =
        Math.max(...headerLines.map((value) => value.length)) * 10 + 10;
      page.drawRectangle({
        x: margin,
        y: y - height,
        width,
        height,
        color: accent,
      });
      let x = margin;
      headerLines.forEach((cell, index) => {
        cell.forEach((line, lineIndex) =>
          draw(line, x + 5, y - 12 - lineIndex * 10, 7.5, rgb(1, 1, 1)),
        );
        x += columns[index].width;
      });
      y -= height;
    };
    head();
    if (!rows.length)
      rows = [columns.map((_, index) => (index === 0 ? "No records" : ""))];
    for (const [index, row] of rows.entries()) {
      if (index % 24 === 0) await pause();
      const wrapped = row.map((cell, i) =>
        lines(cell, 8, columns[i].width - 10),
      );
      const lineCount = Math.max(1, ...wrapped.map((cell) => cell.length));
      if (y - (lineCount * 10.5 + 8) < bottom && lineCount * 10.5 + 8 < 420) {
        nextPage(`${title} - continued`);
        head();
      }
      let offset = 0;
      while (offset < lineCount) {
        const capacity = Math.floor((y - bottom - 8) / 10.5);
        if (capacity < 1) {
          nextPage(`${title} - continued`);
          head();
          continue;
        }
        const count = Math.min(capacity, lineCount - offset),
          height = count * 10.5 + 8;
        if (index % 2 === 0)
          page.drawRectangle({
            x: margin,
            y: y - height,
            width,
            height,
            color: pale,
          });
        let x = margin;
        wrapped.forEach((cell, i) => {
          cell
            .slice(offset, offset + count)
            .forEach((line, lineIndex) =>
              draw(
                line,
                columns[i].right
                  ? x + columns[i].width - 5 - measure(line, 8)
                  : x + 5,
                y - 12 - lineIndex * 10.5,
                8,
              ),
            );
          x += columns[i].width;
        });
        y -= height;
        page.drawLine({
          start: { x: margin, y },
          end: { x: 808, y },
          thickness: 0.25,
          color: rule,
        });
        offset += count;
        if (offset < lineCount) {
          await pause();
          nextPage(`${title} - row continued`);
          head();
        }
      }
    }
    y -= 21;
  };
  const cols = (
    labels: string[],
    weights: number[],
    numericFrom = 1,
  ): Column[] => {
    const total = weights.reduce((a, b) => a + b, 0);
    return labels.map((label, i) => ({
      label,
      width: (width * weights[i]) / total,
      right: i >= numericFrom,
    }));
  };
  draw("SLD POWER FLOW", margin, 551, 22);
  draw("ENGINEERING STUDY REPORT", margin, 530, 10, muted);
  const titleLines = lines(caseName, 18, width);
  titleLines.forEach((line, i) => draw(line, margin, 499 - i * 23, 18));
  y = 499 - titleLines.length * 23 - 2;
  paragraph(
    `Revision ${doc.revision}  |  ${run.status.toUpperCase()}  |  ${result.system.energized_bus_count} energized buses  |  ${run.iterations ?? "unreported"} iterations  |  pandapower ${run.solver.backend_version}`,
    9,
  );
  paragraph(
    `Generated ${new Date().toISOString()}  |  ${run.solver.runtime} ${run.solver.runtime_version}`,
    8,
  );
  const diagramTop = y - 4,
    diagramBottom = 113,
    diagramHeight = Math.max(90, diagramTop - diagramBottom);
  page.drawRectangle({
    x: margin,
    y: diagramBottom,
    width,
    height: diagramHeight,
    borderColor: rule,
    borderWidth: 0.6,
    color: rgb(1, 1, 1),
  });
  const png = await pdf.embedPng(diagram),
    scale = Math.min(
      (width - 20) / png.width,
      (diagramHeight - 20) / png.height,
    );
  page.drawImage(png, {
    x: margin + (width - png.width * scale) / 2,
    y: diagramBottom + (diagramHeight - png.height * scale) / 2,
    width: png.width * scale,
    height: png.height * scale,
  });
  draw("SIMULATED STUDY ONLY - NO PHYSICAL EQUIPMENT CONTROL", margin, 92, 9);
  draw(
    "Balanced positive-sequence steady-state AC. Fixed taps; T transformer equivalent.",
    margin,
    76,
    8,
    muted,
  );
  draw(
    "This PDF is a display summary. Retain the companion canonical JSON for full precision and provenance.",
    margin,
    62,
    8,
    muted,
  );
  nextPage("Study summary and numerical conventions");
  await table(
    "System balance",
    cols(["Quantity", "Active power / MW", "Reactive power / MVAr"], [3, 2, 2]),
    [
      [
        marked("Generation", "/results/system"),
        n(result.system.total_generation_mw),
        n(result.system.total_generation_mvar),
      ],
      [
        marked("Served load", "/results/system"),
        n(result.system.total_served_load_mw),
        n(result.system.total_served_load_mvar),
      ],
      [
        marked("Unserved demand", "/results/system"),
        n(result.system.total_unserved_load_mw),
        n(result.system.total_unserved_load_mvar),
      ],
      [
        marked("Network losses", "/results/system"),
        n(result.system.total_loss_mw),
        n(result.system.total_loss_mvar),
      ],
      [
        marked("Slack exchange", "/results/system"),
        n(result.system.slack_p_mw),
        n(result.system.slack_q_mvar),
      ],
    ],
  );
  paragraph(
    "Signs: generation and bus net power are positive injection; loads and shunts are positive consumption. Branch-end P and Q are positive from the named bus into the element. A negative far-end value normally denotes power leaving that element. Voltages are line-to-line kV; angles are degrees.",
    9,
  );
  paragraph(
    "Unavailable means no valid numerical value (for example, isolated equipment); it is never zero. Display values are rounded. The canonical JSON and workbook retain full values, unavailable reasons, input sources and solver mappings.",
    9,
  );
  paragraph(
    "* Result depends on accepted defaults. This marker applies to the complete bus, equipment or system row; consult its versioned input sources in the assumptions register.",
    9,
  );
  paragraph(
    `Solver: ${run.solver.algorithm}; tolerance ${run.solver.tolerance_mva} MVA; maximum ${run.solver.max_iterations} iterations; Q-limit enforcement ${run.solver.enforce_q_limits ? "on" : "off"}. Defaulted inputs: ${run.quality.defaulted_input_paths.length}. Consult the assumptions register before interpreting dependent results.`,
    9,
  );
  paragraph(`Input SHA-256: ${run.input_hash}`, 8);
  paragraph(`Runtime lock digest: ${run.solver.package_lock_digest}`, 8);
  nextPage("Bus voltages and injections");
  await table(
    "Buses",
    cols(
      [
        "Bus / canonical ID",
        "State",
        "Voltage\nkV",
        "Voltage\npu",
        "Angle\ndeg",
        "Net P\nMW",
        "Net Q\nMVAr",
      ],
      [2.4, 1, 1, 1, 1, 1, 1],
      2,
    ),
    result.buses.map((bus, index) => [
      marked(
        bus.busbar_ids.length
          ? bus.busbar_ids.map(name).join("; ")
          : `Auxiliary bus ${bus.solver_bus_id}`,
        `/results/buses/${index}`,
      ),
      bus.energized ? "energized" : "isolated",
      n(bus.voltage_kv),
      n(bus.voltage_pu, 5),
      n(bus.angle_degree),
      n(bus.net_p_mw),
      n(bus.net_q_mvar),
    ]),
  );
  await table(
    "Generators and external grids",
    cols(
      [
        "Equipment",
        "State",
        "P\nMW",
        "Q\nMVAr",
        "Voltage\nkV",
        "Reactive-limit status",
      ],
      [2.5, 1, 1, 1, 1, 2],
      2,
    ),
    [...result.external_grids, ...result.generators].map((item) => [
      equipmentName(item.element_id),
      item.energized ? "energized" : "isolated",
      n(item.p_mw),
      n(item.q_mvar),
      n(item.voltage_kv),
      item.at_q_min
        ? "At minimum"
        : item.at_q_max
          ? "At maximum"
          : item.at_q_min === null && item.at_q_max === null
            ? "Not reported"
            : "Within limits",
    ]),
  );
  await table(
    "Loads and shunts",
    cols(
      ["Equipment", "Type", "State", "P / MW", "Q / MVAr"],
      [3, 1, 1, 1, 1],
      3,
    ),
    [
      ...result.loads.map((item) => ({ item, type: "Load" })),
      ...result.shunts.map((item) => ({ item, type: "Shunt" })),
    ].map(({ item, type }) => [
      equipmentName(item.element_id),
      type,
      item.energized ? "energized" : "isolated",
      n(item.p_mw),
      n(item.q_mvar),
    ]),
  );
  nextPage("Branch flows, currents and losses");
  const branchColumns = cols(
    [
      "Equipment",
      "State",
      "P from\nMW",
      "Q from\nMVAr",
      "P to\nMW",
      "Q to\nMVAr",
      "I from\nkA",
      "I to\nkA",
      "Loading\n%",
      "P loss\nMW",
      "Q loss\nMVAr",
    ],
    [1.7, 0.8, 1, 1, 1, 1, 0.9, 0.9, 0.9, 1, 1],
    2,
  );
  await table(
    "Lines and cables",
    branchColumns,
    result.lines.map((item) => [
      equipmentName(item.element_id),
      item.energized ? "on" : "off",
      n(item.p_from_mw),
      n(item.q_from_mvar),
      n(item.p_to_mw),
      n(item.q_to_mvar),
      n(item.i_from_ka, 4),
      n(item.i_to_ka, 4),
      n(item.loading_percent, 2),
      n(item.p_loss_mw, 4),
      n(item.q_loss_mvar, 4),
    ]),
    "From/to refer to canonical terminal roles. Both end currents and both end powers are shown.",
  );
  await table(
    "Two-winding transformers",
    cols(
      [
        "Equipment",
        "State",
        "P HV\nMW",
        "Q HV\nMVAr",
        "P LV\nMW",
        "Q LV\nMVAr",
        "I HV\nkA",
        "I LV\nkA",
        "Load\n%",
        "P loss\nMW",
        "Q loss\nMVAr",
        "Tap",
      ],
      [1.7, 0.7, 1, 1, 1, 1, 0.9, 0.9, 0.9, 1, 1, 0.7],
      2,
    ),
    result.transformers.map((item) => [
      equipmentName(item.element_id),
      item.energized ? "on" : "off",
      n(item.p_hv_mw),
      n(item.q_hv_mvar),
      n(item.p_lv_mw),
      n(item.q_lv_mvar),
      n(item.i_hv_ka, 4),
      n(item.i_lv_ka, 4),
      n(item.loading_percent, 2),
      n(item.p_loss_mw, 4),
      n(item.q_loss_mvar, 4),
      n(item.tap_position, 0),
    ]),
    "HV/LV refer to winding terminals. Tap is the fixed solved position.",
  );
  nextPage("Validation findings");
  const findings = doc.validation?.findings ?? run.diagnostics;
  await table(
    "Current findings",
    cols(
      [
        "Rule / severity",
        "Equipment",
        "Finding and measured limit",
        "Suggested correction",
      ],
      [1.2, 1.5, 3.2, 3.1],
      99,
    ),
    findings.map((item) => [
      `${item.rule_id} / ${item.severity}`,
      item.element_ids.join(", ") || "Case",
      `${item.message}${item.observed_value ? ` Observed: ${item.observed_value.value} ${item.observed_value.unit}.` : ""}${item.limit ? ` Limit: ${item.limit.value} ${item.limit.unit}.` : ""}`,
      item.suggested_fix,
    ]),
    "Warnings do not certify suitability. Outage findings remain visible even when an explicitly authorized energized solve is allowed.",
  );
  const assumptions = assumptionsRegister(doc),
    references = new Map<string, string>(),
    referenceRows: string[][] = [];
  const provenanceRef = (provenance: import("../model").Provenance) => {
    const key = JSON.stringify(provenance);
    const existing = references.get(key);
    if (existing) return existing;
    const id = `R${references.size + 1}`;
    references.set(key, id);
    let detail = "";
    if (provenance.source === "library")
      detail = `${provenance.library_id} v${provenance.library_version}; item ${provenance.item_id}; accepted ${provenance.accepted_at}`;
    else if (provenance.source === "default")
      detail = `${provenance.default_id} v${provenance.default_version}; accepted ${provenance.accepted_at}; ${provenance.rationale}`;
    else if (provenance.source === "user")
      detail = `Changed ${provenance.changed_at}${provenance.supersedes_path ? `; supersedes ${provenance.supersedes_path}` : ""}${provenance.evidence.length ? `; drawing evidence ${provenance.evidence.map((ref) => `${ref.file_id} p${ref.page}`).join(", ")}` : ""}`;
    else detail = `Drawing extraction ${provenance.extraction_run_id}`;
    referenceRows.push([id, provenance.source, detail]);
    return id;
  };
  const compact = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if ("status" in value) {
      const field = value as { status: string; value?: unknown };
      return field.status === "known" ? compact(field.value) : "missing";
    }
    if (Array.isArray(value)) return value.map(compact);
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, compact(item)]),
    );
  };
  const assumptionRows = assumptions.map((item) => {
    const parts = item.path.split("/").filter(Boolean);
    let label: string;
    if (parts[0] === "elements")
      label = `${doc.elements[Number(parts[1])]?.id ?? parts[1]} / ${parts
        .slice(2)
        .filter((part) => !["data", "value"].includes(part))
        .join(".")}`;
    else label = parts.join(".");
    const value = compact(item.value),
      shown =
        value === null
          ? "not applicable"
          : typeof value === "number"
            ? Number(value.toPrecision(6)).toString()
            : typeof value === "string"
              ? value
              : JSON.stringify(value);
    return [
      label,
      `${shown}${inputUnit(item.attribute) ? ` ${inputUnit(item.attribute)}` : ""}`,
      item.source,
      provenanceRef(item.provenance),
    ];
  });
  nextPage("Assumptions and accepted-input sources");
  paragraph(
    `${assumptions.length} accepted non-drawing input fields. Every row is retained, including user values and explicit library/default selections. Reference IDs link to the source register below; detailed JSON pointers and complete provenance remain in canonical-case.json.`,
    9,
  );
  await table(
    "Source references",
    cols(
      ["Ref", "Source", "Versioned source / acceptance / rationale"],
      [0.5, 0.9, 6],
      99,
    ),
    referenceRows,
  );
  nextPage("Assumptions register");
  const panelWidth = (width - 18) / 2,
    assumptionWidths = [
      panelWidth * 0.43,
      panelWidth * 0.34,
      panelWidth * 0.14,
      panelWidth * 0.09,
    ];
  let column = 0,
    rowIndex = 0;
  const top = 504;
  const registerHead = () => {
    const x = margin + column * (panelWidth + 18);
    page.drawRectangle({
      x,
      y: y - 23,
      width: panelWidth,
      height: 23,
      color: accent,
    });
    let offset = x;
    ["Element / field", "Accepted value", "Source", "Ref"].forEach(
      (label, index) => {
        draw(label, offset + 4, y - 14, 7.5, rgb(1, 1, 1));
        offset += assumptionWidths[index];
      },
    );
    y -= 23;
  };
  registerHead();
  for (const row of assumptionRows) {
    if (rowIndex % 30 === 0) await pause();
    const wrapped = row.map((value, index) =>
      lines(value, 7.5, assumptionWidths[index] - 8),
    );
    const lineCount = Math.max(1, ...wrapped.map((value) => value.length));
    const advance = () => {
      if (column === 0) {
        column = 1;
        y = top;
      } else {
        nextPage("Assumptions register - continued");
        column = 0;
      }
      registerHead();
    };
    if (
      y - (lineCount * 9.5 + 5) < bottom &&
      lineCount * 9.5 + 5 < top - bottom - 23
    )
      advance();
    let lineOffset = 0;
    while (lineOffset < lineCount) {
      const capacity = Math.floor((y - bottom - 5) / 9.5);
      if (capacity < 1) {
        advance();
        continue;
      }
      const count = Math.min(capacity, lineCount - lineOffset),
        height = count * 9.5 + 5;
      const x = margin + column * (panelWidth + 18);
      if (rowIndex % 2 === 0)
        page.drawRectangle({
          x,
          y: y - height,
          width: panelWidth,
          height,
          color: pale,
        });
      let offset = x;
      wrapped.forEach((cell, index) => {
        cell
          .slice(lineOffset, lineOffset + count)
          .forEach((line, lineIndex) =>
            draw(line, offset + 4, y - 11 - lineIndex * 9.5, 7.5),
          );
        offset += assumptionWidths[index];
      });
      y -= height;
      lineOffset += count;
      if (lineOffset < lineCount) {
        await pause();
        advance();
      }
    }
    rowIndex++;
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawLine({
      start: { x: margin, y: 31 },
      end: { x: 808, y: 31 },
      color: rule,
      thickness: 0.5,
    });
    sheet.drawText(`STUDY MODE  |  Revision ${doc.revision}`, {
      x: margin,
      y: 18,
      size: 7.5,
      font,
      color: muted,
    });
    const label = `${index + 1} / ${pages.length}`;
    sheet.drawText(label, {
      x: 808 - measure(label, 7.5),
      y: 18,
      size: 7.5,
      font,
      color: muted,
    });
  });
  await pause();
  return pdf.save();
}
