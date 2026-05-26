import { parse as parseCsv } from "csv-parse/sync";

import {
  PayloadTooLargeError,
  ValidationError,
} from "@school-kit/types";

// CSV preflight parser. Used by the upload endpoint to extract headers,
// count rows, and grab the first ~5 sample rows BEFORE the file is persisted
// to storage. Everything here is synchronous on a Buffer that's already
// fully in memory (Multer's `memoryStorage()` mode is in use, with a 5 MB
// cap), so parsing the whole CSV up-front is fine — see CLAUDE.md's
// "per-row transactions" rationale for why we accept the small re-parse
// cost in the validate worker (cp3) too.
//
// Why synchronous parse here rather than streaming:
//   1. The spec promises the upload response carries headers + sampleRows;
//      a streaming parse would require a deferred resolution and the UI
//      would still wait the same wall-clock time.
//   2. We need an authoritative row count BEFORE writing to storage so
//      TOO_MANY_ROWS rejection doesn't pay storage cost (CLAUDE.md / spec
//      line 942 — explicit requirement).
//   3. The 5 MB cap means a worst-case ~75k rows of single-column data, or
//      ~10k rows of typical student-CSV width — both well under 100 ms
//      parse time on commodity hardware. Streaming would be premature.
//
// The parser uses `csv-parse/sync` with `bom: true` to strip Excel's
// UTF-8 BOM and `relax_quotes: true` to tolerate stray double-quotes in
// mid-cell text (a common Excel export quirk that legitimately occurs in
// Nigerian addresses like `Plot "A"`). Strict mode would be more correct
// in the abstract but would reject real-world CSVs schools actually
// produce. Validate/commit workers re-parse the same way for symmetry.

const MAX_DATA_ROWS = 10_000;
const SAMPLE_ROW_COUNT = 5;

export interface CsvPreflightResult {
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
}

export function preflightCsv(buffer: Buffer): CsvPreflightResult {
  // csv-parse returns the header row as the first element when columns:true
  // is set with a function. We pass columns:true (auto-detect from header row)
  // and capture the inferred header list via the onRecord callback that
  // surfaces them — but cleanest is to ask the parser to return records as
  // objects keyed by header, AND ask the info object back for the column
  // list. The library exposes the latter via `info: true` on the parse call
  // but only on a per-record basis; instead we run two passes:
  //   1. parse with columns:false to get the raw rows array; the first row
  //      is the header.
  //   2. zip subsequent rows into objects keyed by that header.
  //
  // Two passes is one extra O(n) loop on the in-memory rows. Acceptable
  // given the 5 MB / 10k row cap.

  let rows: string[][];
  try {
    rows = parseCsv(buffer, {
      bom: true,
      skip_empty_lines: true,
      trim: false,
      relax_quotes: true,
      // columns:false → rows come back as string[]. Crucial: we want the
      // header row to be the FIRST row of the result so we can detect a
      // missing-header case (which manifests as headers === rows[0] === [],
      // not as an exception).
      columns: false,
    }) as string[][];
  } catch (e) {
    // csv-parse throws on truly malformed input (e.g. broken quoting that
    // even relax_quotes can't recover from, or non-UTF-8 bytes). Convert
    // to the 400 INVALID_CSV envelope rather than letting the global
    // HttpExceptionFilter route this to 500.
    throw new ValidationError(
      "INVALID_CSV",
      "Could not parse this file as CSV. Check the formatting and try again.",
      { reason: e instanceof Error ? e.message : "parse failed" },
    );
  }

  if (rows.length === 0) {
    throw new ValidationError(
      "INVALID_CSV",
      "The uploaded file is empty.",
    );
  }

  const rawHeaders = rows[0];
  // Trim every header so " Adm No" and "Adm No" don't masquerade as
  // distinct columns. Excel exports occasionally pad cells.
  const headers = rawHeaders.map((h) => h.trim());

  if (headers.length === 0 || headers.every((h) => h.length === 0)) {
    throw new ValidationError(
      "INVALID_CSV",
      "No headers detected — the first row of the file is empty.",
    );
  }
  if (headers.some((h) => h.length === 0)) {
    throw new ValidationError(
      "INVALID_CSV",
      "Some header cells are blank. Every column needs a name.",
    );
  }

  // Duplicate-header check. Spec calls for 400 AMBIGUOUS_HEADERS so the
  // wizard can show a precise error citing the offending names.
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const h of headers) {
    if (seen.has(h)) duplicates.push(h);
    seen.add(h);
  }
  if (duplicates.length > 0) {
    throw new ValidationError(
      "AMBIGUOUS_HEADERS",
      `The file has duplicate column names: ${[...new Set(duplicates)].join(", ")}. Rename them in the source file and try again.`,
      { duplicateHeaders: [...new Set(duplicates)] },
    );
  }

  const dataRowCount = rows.length - 1;

  // Row-cap rejection MUST happen before storage persist. The plan + spec
  // call this out specifically (CLAUDE.md / phase-1.md line 942).
  if (dataRowCount > MAX_DATA_ROWS) {
    throw new PayloadTooLargeError(
      "TOO_MANY_ROWS",
      `This file has ${dataRowCount} rows. The limit is ${MAX_DATA_ROWS} rows per upload. Please split it into smaller files and upload them separately.`,
      { rowCount: dataRowCount, limit: MAX_DATA_ROWS },
    );
  }

  // Build sample-row objects keyed by header. Skip empty data rows that
  // csv-parse might have left in despite skip_empty_lines (Excel
  // sometimes writes ,,, lines at the end of a sheet).
  const sampleRows: Record<string, string>[] = [];
  for (let i = 1; i < rows.length && sampleRows.length < SAMPLE_ROW_COUNT; i++) {
    const dataRow = rows[i];
    if (dataRow.every((c) => (c ?? "").trim() === "")) continue;
    const obj: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      obj[headers[h]] = (dataRow[h] ?? "").trim();
    }
    sampleRows.push(obj);
  }

  return {
    headers,
    sampleRows,
    totalRows: dataRowCount,
  };
}

export const CSV_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_DATA_ROWS = MAX_DATA_ROWS;
