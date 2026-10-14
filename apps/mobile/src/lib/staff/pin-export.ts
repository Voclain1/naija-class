import type { GeneratedResultPinBatchDto } from "@school-kit/types";

// Result PIN cards leaving the phone (docs/modules/phase-8.md §21.3, D16: the
// PINs exist only in the response to generating them). The web's two forms
// (apps/web/src/lib/result-pins/pin-export.ts), for the share sheet and the
// system print dialog: a CSV for a print shop, and a sheet of cut-out cards.
// Brought to the app by the owner's decision on the pre-build audit
// (2026-10-14). Pure, so what goes on a card is specified by a test.

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function rowsToCsv<T>(rows: T[], columns: { header: string; accessor: (row: T) => string | number }[]): string {
  const head = columns.map((c) => escapeCsvCell(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCsvCell(c.accessor(row))).join(","));
  return [head, ...lines].join("\r\n");
}

// The two forms a freshly generated batch leaves the browser in (D16: once,
// at generation): a CSV for a print shop, and a printable sheet of cards.
// Pure, so what goes on a card is specified by a test.

export interface PinSheetContext {
  schoolName: string;
  /** e.g. "https://portal.schoolkit.ng/result-checker/st-mary" */
  checkerUrl: string;
}

export function pinBatchCsv(generated: GeneratedResultPinBatchDto): string {
  const { batch } = generated;
  return rowsToCsv(generated.pins, [
    { header: "Serial", accessor: (p) => p.serial },
    { header: "PIN", accessor: (p) => p.pin },
    { header: "Term", accessor: () => batch.termName },
    { header: "Session", accessor: () => batch.academicYearLabel },
    { header: "Uses", accessor: () => batch.maxUses },
  ]);
}

export function pinBatchFilename(generated: GeneratedResultPinBatchDto): string {
  const { batch } = generated;
  const slug = `${batch.academicYearLabel}-${batch.termName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `result-pins-batch-${batch.number}-${slug}.csv`;
}

function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A self-contained HTML page of cut-out cards, one per PIN, for the school's
 * own printer. Every interpolated value is escaped — the school name is
 * tenant data. No accent borders (CLAUDE.md): cards are separated by a plain
 * dashed cut line, the one border a cut-out sheet needs.
 */
export function pinBatchPrintHtml(generated: GeneratedResultPinBatchDto, ctx: PinSheetContext): string {
  const { batch } = generated;
  const cards = generated.pins
    .map(
      (p) => `
    <div class="card">
      <div class="school">${esc(ctx.schoolName)}</div>
      <div class="term">Result PIN · ${esc(batch.termName)} ${esc(batch.academicYearLabel)}</div>
      <div class="pin">${esc(p.pin)}</div>
      <div class="meta">Serial ${esc(p.serial)} · ${esc(batch.maxUses)} uses</div>
      <div class="how">Check results at ${esc(ctx.checkerUrl)} with the student's admission number and this PIN.</div>
    </div>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Result PINs — batch ${esc(batch.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 12mm; color: #13262e; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; }
  .card { border: 1px dashed #9aa5a9; padding: 10px 12px; break-inside: avoid; }
  .school { font-weight: 700; font-size: 13px; }
  .term { font-size: 11px; color: #555; margin-top: 2px; }
  .pin { font-family: "Courier New", monospace; font-size: 20px; font-weight: 700; letter-spacing: 1px; margin: 8px 0 4px; background: #f7f5ef; padding: 4px 6px; border-radius: 4px; }
  .meta { font-size: 10px; color: #555; }
  .how { font-size: 9px; color: #555; margin-top: 6px; }
</style>
</head>
<body>
  <div class="sheet">${cards}</div>
</body>
</html>`;
}

export const PIN_BATCH_MAX = 2000;
export const PIN_USES_MAX = 20;

export type PinBatchForm =
  | { ok: true; quantity: number; maxUses: number }
  | { ok: false; error: string };

/** The form's two numbers, held to the server's limits (generateResultPinBatchSchema). */
export function parsePinBatchForm(quantity: string, maxUses: string): PinBatchForm {
  const q = quantity.trim();
  const u = maxUses.trim();
  if (!/^\d+$/.test(q) || Number(q) < 1 || Number(q) > PIN_BATCH_MAX) {
    return { ok: false, error: `Make between 1 and ${PIN_BATCH_MAX.toLocaleString("en-NG")} PINs at a time.` };
  }
  if (!/^\d+$/.test(u) || Number(u) < 1 || Number(u) > PIN_USES_MAX) {
    return { ok: false, error: `Each PIN can be used between 1 and ${PIN_USES_MAX} times.` };
  }
  return { ok: true, quantity: Number(q), maxUses: Number(u) };
}
