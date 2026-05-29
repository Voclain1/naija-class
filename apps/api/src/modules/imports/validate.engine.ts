import { parse as parseCsv } from "csv-parse/sync";

import type {
  ImportOptions,
  ImportRowError,
  ImportRowGood,
} from "@school-kit/types";

// Shared validation engine utilities — slice 6 used this for STUDENTS;
// slice 8 extracted the type-specific dedup logic into per-type engine
// files (validate-students.engine.ts, validate-guardians.engine.ts), so
// what remains here is:
//
//   - EngineFatalError + the typed PersistedMapping shape (mapping JSON
//     stored on ImportJob.columnMapping)
//   - parsePersistedMapping (defensive re-parse of the JSON column at
//     worker time — the mapping endpoint validates it at write but a
//     corrupt column would otherwise produce confusing engine errors)
//   - parseSourceCsv — the per-row parse loop with blank-row handling.
//     Returns per-type Good/Bad piles; the caller is responsible for
//     any dedup phases that come after.
//   - badRowsToCsv — RFC 4180 cell escape + `_errors` column emitter
//   - buildBadRowsFromSource — re-stream helper for the bad-rows
//     download endpoint
//
// Why a re-stream rather than persisting the full bad-rows list on the
// row: the previewSnapshot we store is the FIRST 50 of each pile (per
// spec line 879). A 10k-row CSV with 8k bad rows would otherwise need
// a 1-2 MB JSON column. Re-streaming costs ~10ms on the dev filesystem,
// ~100-300ms on R2 — well inside the download UX budget.
//
// Fatal vs transient errors:
//   - `EngineFatalError` ("source missing", "csv unparseable", "mapping
//     incoherent") → worker throws UnrecoverableError so BullMQ does NOT
//     retry. Three attempts on a missing file is just three log noises.
//   - Anything else (DB transient, Redis blip, OOM-pressure) → worker
//     lets it bubble; BullMQ retries per queue config (3x exponential).

export class EngineFatalError extends Error {
  readonly kind: "source_missing" | "unparseable_csv" | "mapping_incoherent";
  readonly engineCause: unknown;
  constructor(
    kind: EngineFatalError["kind"],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "EngineFatalError";
    this.kind = kind;
    this.engineCause = cause;
  }
}

// What the per-type validate engines return. `good` and `bad` are the
// COMPLETE accumulators (the worker slices the first 50 of each for
// previewSnapshot; the bad-rows download emits all of `bad`).
// `totalRows` is the count of data rows actually evaluated — blank rows
// don't count (same convention as the cp2 preflight: skip-empty-then-count).
// `headers` is exposed so the bad-rows download can write them as the
// CSV header without re-parsing.
export interface EngineResult<Row> {
  good: ImportRowGood<Row>[];
  bad: ImportRowError[];
  totalRows: number;
  headers: string[];
}

// Parse the persisted ImportJob.columnMapping JSON column back into the
// shape parseStudentImportRow / parseGuardianImportRow expects. Throws
// EngineFatalError if the column is missing or malformed — neither should
// happen in practice (POST /imports/:jobId/mapping validates it before
// writing), but the engine refuses to silently accept a half-state.
export interface PersistedMapping {
  mapping: Record<string, string | null>;
  options: ImportOptions;
}

export function parsePersistedMapping(raw: unknown): PersistedMapping {
  if (typeof raw !== "object" || raw === null) {
    throw new EngineFatalError(
      "mapping_incoherent",
      "ImportJob.columnMapping is missing or not an object.",
    );
  }
  const mapping = (raw as { mapping?: unknown }).mapping;
  const options = (raw as { options?: unknown }).options;
  if (typeof mapping !== "object" || mapping === null) {
    throw new EngineFatalError(
      "mapping_incoherent",
      "ImportJob.columnMapping.mapping is missing or not an object.",
    );
  }
  // Trust the values shape — applyMappingSchema already validated it at
  // write time. We re-narrow defensively just to give a clearer error if
  // something corrupts the column.
  for (const [k, v] of Object.entries(mapping)) {
    if (typeof k !== "string" || (v !== null && typeof v !== "string")) {
      throw new EngineFatalError(
        "mapping_incoherent",
        `ImportJob.columnMapping has malformed entry: ${k} → ${typeof v}.`,
      );
    }
  }
  const opts = options as Partial<ImportOptions> | undefined;
  return {
    mapping: mapping as Record<string, string | null>,
    options: {
      dateFormat: opts?.dateFormat ?? "YYYY-MM-DD",
      treatBlankAs: opts?.treatBlankAs ?? "skip",
    },
  };
}

// -----------------------------------------------------------------------
// parseSourceCsv — the slice 8 extraction.
//
// Takes the source bytes + a per-type row parser, returns the headers,
// the per-type Good/Bad piles AFTER schema validation but BEFORE any
// dedup phases. Each per-type engine layers its own dedup on top.
//
// ROW-NUMBERING: rowNumber is the 1-based DATA row index. The header
// is row 0 (the first line of the CSV). The first data line — directly
// under the header — is rowNumber 1. A blank line occupies a rowNumber
// slot but is NOT emitted as good or bad (it doesn't contribute to
// totalRows either).
//
// For an admin opening the CSV in Excel: the bad-rows.csv preserves
// each bad row's content, so they find it by matching values. The
// rowNumber field tells them "this is the Nth row below the header
// in your source file" — useful for a CSV with thousands of rows.
// -----------------------------------------------------------------------
export type RowParser<Row> = (
  rowNumber: number,
  csvRow: Record<string, string>,
  columnMapping: Record<string, string | null>,
  options: ImportOptions,
) =>
  | { ok: true; row: ImportRowGood<Row> }
  | { ok: false; row: ImportRowError };

export interface ParseSourceCsvResult<Row> {
  headers: string[];
  good: ImportRowGood<Row>[];
  bad: ImportRowError[];
  evaluatedRowCount: number;
}

export function parseSourceCsv<Row>(
  sourceBytes: Buffer,
  columnMapping: Record<string, string | null>,
  options: ImportOptions,
  parseRow: RowParser<Row>,
): ParseSourceCsvResult<Row> {
  let rows: string[][];
  try {
    rows = parseCsv(sourceBytes, {
      bom: true,
      // skip_empty_lines: FALSE so rowNumber matches the source CSV's
      // data-row offset from the header. A blank row is a line that
      // occupies a rowNumber but we don't emit it as good or bad.
      skip_empty_lines: false,
      trim: false,
      relax_quotes: true,
      // relax_column_count: TRUE so a literal blank line (which parses
      // as `[]` and would otherwise fail csv-parse's strict-length
      // check against the header's column count) is accepted. Per-row
      // short/long-cell handling is downstream — every CSV row in the
      // wild produces ragged columns somewhere.
      relax_column_count: true,
      columns: false,
    }) as string[][];
  } catch (e) {
    throw new EngineFatalError(
      "unparseable_csv",
      `Could not parse source.csv: ${e instanceof Error ? e.message : "unknown error"}`,
      e,
    );
  }

  if (rows.length === 0) {
    throw new EngineFatalError(
      "unparseable_csv",
      "source.csv is empty (no header row).",
    );
  }

  const headers = rows[0].map((h) => h.trim());

  const good: ImportRowGood<Row>[] = [];
  const bad: ImportRowError[] = [];
  let evaluatedRowCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const rawRow = rows[i];
    const isBlank =
      rawRow.length === 0 || rawRow.every((c) => (c ?? "").trim() === "");
    if (isBlank) continue;

    evaluatedRowCount += 1;
    const rowNumber = i;

    const csvRow: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      csvRow[headers[h]] = (rawRow[h] ?? "").trim();
    }

    const result = parseRow(rowNumber, csvRow, columnMapping, options);
    if (result.ok) {
      good.push(result.row);
    } else {
      bad.push(result.row);
    }
  }

  return { headers, good, bad, evaluatedRowCount };
}

// -----------------------------------------------------------------------
// badRowsToCsv — serialise bad rows to a CSV string. The header row uses
// the ORIGINAL detected headers (so an admin opening it in Excel sees the
// same columns as their source) plus a final `_errors` column. The body
// re-streams from the source: we need the original CSV row content
// verbatim (not the parsed values which lose formatting / failed-parse
// inputs). The caller passes both the engine result and the raw row
// objects keyed by header — both can be produced by walking source.csv
// once.
//
// We escape CSV cells per RFC 4180: wrap in quotes if the cell contains
// comma, quote, CR, or LF; double internal quotes.
// -----------------------------------------------------------------------
export function badRowsToCsv(
  headers: string[],
  badRowsBySrc: Array<{
    rowNumber: number;
    csvRow: Record<string, string>;
    errors: { field: string; message: string }[];
  }>,
): Buffer {
  const allHeaders = [...headers, "_errors"];
  const lines: string[] = [allHeaders.map(escapeCsvCell).join(",")];

  for (const bad of badRowsBySrc) {
    const cells = headers.map((h) => escapeCsvCell(bad.csvRow[h] ?? ""));
    const errorSummary = bad.errors
      .map((e) => `${e.field}: ${e.message}`)
      .join(" | ");
    cells.push(escapeCsvCell(errorSummary));
    lines.push(cells.join(","));
  }

  return Buffer.from(lines.join("\r\n") + "\r\n", "utf-8");
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// -----------------------------------------------------------------------
// buildBadRowsFromSource — re-stream the source CSV to build the
// (rowNumber, csvRow) pairs that bad-rows.csv needs. We re-parse rather
// than relying on the engine's reconstructed-from-parsed rows because
// the bad entries from schema/date/gender failures carry the ORIGINAL
// csvRow (the parser preserves it on failure) — but the dedup-failures
// don't. For the download we want source-fidelity row contents always.
// -----------------------------------------------------------------------
export function buildBadRowsFromSource(
  sourceBytes: Buffer,
  bad: ImportRowError[],
): Array<{
  rowNumber: number;
  csvRow: Record<string, string>;
  errors: { field: string; message: string }[];
}> {
  const rows = parseCsv(sourceBytes, {
    bom: true,
    skip_empty_lines: false,
    trim: false,
    relax_quotes: true,
    relax_column_count: true,
    columns: false,
  }) as string[][];

  const headers = rows[0].map((h) => h.trim());
  const sourceByRowNumber = new Map<number, Record<string, string>>();
  for (let i = 1; i < rows.length; i++) {
    const rawRow = rows[i];
    const isBlank =
      rawRow.length === 0 || rawRow.every((c) => (c ?? "").trim() === "");
    if (isBlank) continue;
    const obj: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      obj[headers[h]] = (rawRow[h] ?? "").trim();
    }
    sourceByRowNumber.set(i, obj);
  }

  return bad.map((b) => ({
    rowNumber: b.rowNumber,
    csvRow: sourceByRowNumber.get(b.rowNumber) ?? b.csvRow,
    errors: b.errors,
  }));
}

// Re-derive an object keyed by canonical field name from a parsed-good
// row. Used by per-type engines when a row was originally parsed-good
// but later moved to bad by dedup — we discarded the original csvRow at
// parse success, so we reconstruct what we need to render in the
// previewSnapshot.bad pile. Field naming uses the schema's canonical
// field names rather than the CSV headers; bad-rows.csv has a separate
// path (buildBadRowsFromSource) that re-streams the ORIGINAL CSV.
export function rebuildCsvRowFromParsed(
  parsed: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === undefined || v === null) continue;
    if (v instanceof Date) {
      out[k] = v.toISOString().slice(0, 10); // YYYY-MM-DD
    } else {
      out[k] = String(v);
    }
  }
  return out;
}
