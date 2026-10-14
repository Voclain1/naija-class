import ExcelJS from "exceljs";

import { esc } from "../../modules/report-cards/render/report-card-template.js";

// Phase 9 / CP1 — one export helper for every table SchoolKit lets a school
// take away (docs/modules/phase-9.md §4 F3, §8 CP1-D1).
//
// A caller describes its table ONCE — columns, each with a header and a value
// for a row — and gets the same table as an Excel workbook or as print-ready
// HTML for the render worker's PDF. Nothing here reads the database or decides
// who may export: callers pass rows they already fetched through a guarded,
// audited read, exactly as the browser's csv-export.ts does.
//
// Numbers stay numbers in Excel (a school sorts and totals them); everything
// else is written as a string value, never a formula, so a name beginning with
// "=" cannot run as one.

export type ExportCell = string | number | null;

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => ExportCell;
  /** Right-aligned in the PDF. Excel decides from the value's type. */
  numeric?: boolean;
  /** Fixed decimal places for a number: "73.50" in the PDF, a 0.00 format in Excel. */
  decimals?: number;
}

export interface ExportTable<T> {
  /** Sheet name in Excel and heading in the PDF. */
  title: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** One plain sentence under the heading, e.g. how a figure is counted. */
  note?: string;
}

// Tables of different row types travel together in one document; the row type
// is erased once a table is built, since only its own columns ever read it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyExportTable = ExportTable<any>;

export interface ExportDocument {
  /** e.g. "Registers". */
  title: string;
  schoolName: string;
  /** e.g. "First Term 2026/2027". */
  subtitle: string | null;
  tables: AnyExportTable[];
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MAX_COLUMN_WIDTH = 50;
const MIN_COLUMN_WIDTH = 8;

/** "Registers", "First Term 2026/2027", "xlsx" → "registers-first-term-2026-2027.xlsx". */
export function exportFilename(title: string, subtitle: string | null, ext: string): string {
  const slug = [title, subtitle ?? ""]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return `${slug || "export"}.${ext}`;
}

// Excel refuses sheet names over 31 characters or containing : \ / ? * [ ],
// and two sheets may not share a name (case-insensitively).
function sheetName(title: string, taken: Set<string>): string {
  const base = title.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

export async function toXlsx(doc: ExportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SchoolKit";
  const taken = new Set<string>();

  for (const table of doc.tables) {
    const sheet = workbook.addWorksheet(sheetName(table.title, taken));
    const heading = [doc.title, table.title !== doc.title ? table.title : null].filter(Boolean).join(" — ");
    sheet.addRow([heading]).font = { bold: true, size: 13 };
    sheet.addRow([[doc.schoolName, doc.subtitle].filter(Boolean).join(" · ")]);
    if (table.note) sheet.addRow([table.note]);
    sheet.addRow([]);

    const headerRow = sheet.addRow(table.columns.map((c) => c.header));
    headerRow.font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

    const widths = table.columns.map((c) => c.header.length);
    for (const row of table.rows) {
      const values = table.columns.map((c) => c.value(row));
      sheet.addRow(values.map((v) => (v === null ? null : v)));
      values.forEach((v, i) => {
        widths[i] = Math.max(widths[i] ?? 0, v === null ? 0 : String(v).length);
      });
    }
    widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, w + 2));
    });
    table.columns.forEach((c, i) => {
      if (c.decimals === undefined) return;
      const fmt = c.decimals > 0 ? `0.${"0".repeat(c.decimals)}` : "0";
      for (let r = headerRow.number + 1; r <= sheet.rowCount; r++) sheet.getRow(r).getCell(i + 1).numFmt = fmt;
    });
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export interface PrintHtmlOptions {
  /** data: URI of the school's logo, or null for none. */
  logoDataUri: string | null;
  /** Lagos date the copy was made, YYYY-MM-DD. */
  printedOn: string;
}

// Print-ready HTML for the render worker. Every value goes through esc(): this
// HTML is printed by Chromium, so a name holding markup must stay text.
// Gridlines are plain 1px borders on every side; the accent-border rule
// (CLAUDE.md) forbids only a thick or coloured edge on one side.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Numbers and dates never wrap: "2026-10-09" broken at a hyphen reads as two
// values. Text wraps between words only.
function cellClass(numeric: boolean, value: ExportCell): string {
  if (numeric) return "num nowrap";
  return typeof value === "string" && ISO_DATE.test(value) ? "nowrap" : "";
}

export function toPrintHtml(doc: ExportDocument, opts: PrintHtmlOptions): string {
  const tables = doc.tables
    .map((t) => {
      const head = t.columns.map((c) => `<th class="${c.numeric ? "num" : ""}">${esc(c.header)}</th>`).join("");
      const body = t.rows.length
        ? t.rows
            .map(
              (r) =>
                `<tr>${t.columns
                  .map((c) => {
                    const v = c.value(r);
                    const shown = typeof v === "number" && c.decimals !== undefined ? v.toFixed(c.decimals) : v;
                    return `<td class="${cellClass(c.numeric === true, v)}">${esc(shown)}</td>`;
                  })
                  .join("")}</tr>`,
            )
            .join("")
        : `<tr><td colspan="${t.columns.length}" class="empty">Nothing to show.</td></tr>`;
      const title = doc.tables.length > 1 || t.title !== doc.title ? `<h2>${esc(t.title)}</h2>` : "";
      const note = t.note ? `<p class="note">${esc(t.note)}</p>` : "";
      return `<section>${title}${note}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
    })
    .join("");

  const logo = opts.logoDataUri ? `<img class="logo" src="${esc(opts.logoDataUri)}" alt="">` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
  * { box-sizing: border-box; }
  /* A collapsed border sits half outside the table; the side padding keeps the
     right-hand gridline inside the printable area instead of clipped by it. */
  body { font-family: Helvetica, Arial, sans-serif; color: #13262E; font-size: 10pt; margin: 0; padding: 0 2px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .logo { height: 44px; width: auto; }
  h1 { font-size: 15pt; margin: 0; }
  .meta { margin: 2px 0 0; color: #4a5a60; }
  h2 { font-size: 12pt; margin: 16px 0 4px; }
  .note { margin: 0 0 6px; color: #4a5a60; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #c9cfc9; padding: 4px 6px; text-align: left; vertical-align: top; overflow-wrap: break-word; }
  th { background: #eef0ea; }
  .num { text-align: right; }
  .nowrap { white-space: nowrap; }
  .empty { text-align: center; color: #4a5a60; }
</style></head><body>
<header>${logo}<div><h1>${esc(doc.title)}</h1><p class="meta">${esc(
    [doc.schoolName, doc.subtitle, `Printed ${opts.printedOn}`].filter(Boolean).join(" · "),
  )}</p></div></header>
${tables}
</body></html>`;
}
