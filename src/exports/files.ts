import type { StudyDocument } from "../model";
import { solutionTables, type DataTable } from "./tables";
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
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  const pdf = await PDFDocument.create();
  pdf.setTitle("SLD Power Flow study report");
  pdf.setSubject("Simulated balanced positive-sequence AC study");
  pdf.registerFontkit(fontkit);
  const fontResponse = await fetch(
    `${import.meta.env.BASE_URL}fonts/Inter-Regular.ttf`,
  );
  if (!fontResponse.ok) throw new Error("The report font could not load.");
  const font = await pdf.embedFont(await fontResponse.arrayBuffer(), {
    subset: true,
  });
  const bold = font;
  let page = pdf.addPage([842, 595]);
  let y = 550;
  const safe = (text: string) => text.replace(/[\x00-\x08\x0e-\x1f]/g, "");
  const newPage = () => {
    page = pdf.addPage([842, 595]);
    y = 550;
  };
  const write = (text: string, size = 9, strong = false) => {
    const activeFont = strong ? bold : font;
    const emit = (line: string) => {
      if (y < 40) newPage();
      page.drawText(line, {
        x: 34,
        y,
        size,
        font: activeFont,
        color: rgb(0.1, 0.14, 0.2),
      });
      y -= size + 5;
    };
    let line = "";
    for (const char of safe(text)) {
      if (char === "\n") {
        emit(line);
        line = "";
        continue;
      }
      if (activeFont.widthOfTextAtSize(line + char, size) > 770) {
        emit(line);
        line = "";
      }
      line += char;
    }
    emit(line);
    y -= 2;
  };
  write("SLD POWER FLOW / STUDY REPORT", 18, true);
  write(
    "SIMULATED STUDY ONLY. Balanced positive-sequence steady-state AC. No equipment control.",
    10,
    true,
  );
  write(
    `Case: ${doc.meta.name.status === "known" ? doc.meta.name.value : doc.case_id} | revision ${doc.revision} | ${new Date().toISOString()}`,
  );
  write(
    `Input SHA-256: ${doc.solution?.input_hash ?? "Unsolved"} | pandapower ${doc.solution?.solver.backend_version ?? "unknown"}`,
  );
  write(
    "P and Q: positive generation for sources; positive consumption for loads; positive bus-to-branch at each branch end. Fixed transformer taps; T equivalent. Missing/unavailable results are not zero.",
  );
  const png = await pdf.embedPng(diagram);
  const scale = Math.min(770 / png.width, 350 / png.height);
  page.drawImage(png, {
    x: 34,
    y: Math.max(45, y - png.height * scale),
    width: png.width * scale,
    height: png.height * scale,
  });
  newPage();
  const tables: DataTable[] = solutionTables(doc);
  for (const table of tables) {
    write(table.name.toUpperCase(), 13, true);
    if (!table.rows.length) write("No records.");
    for (const row of table.rows) {
      write(
        Object.entries(row)
          .map(([k, v]) => `${k}: ${v === null ? "unavailable" : v}`)
          .join(" | "),
        8,
      );
    }
    y -= 14;
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) =>
    p.drawText(`STUDY MODE | ${index + 1} / ${pages.length}`, {
      x: 34,
      y: 18,
      size: 8,
      font,
      color: rgb(0.3, 0.35, 0.4),
    }),
  );
  return pdf.save();
}
