import type { GeneratedResultPinBatchDto } from "@school-kit/types";

import { rowsToCsv } from "../csv-export";

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
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
}
