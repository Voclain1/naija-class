import { parse as parseCsv } from "csv-parse/sync";

import type { PrismaClient } from "@school-kit/db";
import {
  parseStudentImportRow,
  type StudentImportOptions,
  type StudentImportRowError,
  type StudentImportRowGood,
} from "@school-kit/types";

// Shared validation engine. Run by both the BullMQ validate processor
// (writes the result to ImportJob.previewSnapshot + counts) and the
// GET /imports/:jobId/bad-rows.csv handler (re-streams the source, runs
// the same engine, emits the bad rows as a CSV download).
//
// Why a re-stream rather than persisting the full bad-rows list on the
// row: the previewSnapshot we store is the FIRST 50 of each pile (per
// spec line 879 + the cp2 plan B2 decision). A 10k-row CSV with 8k bad
// rows would otherwise need a 1-2 MB JSON column. Re-streaming costs us
// ~10ms on the dev filesystem, ~100-300ms on R2 — well inside the
// download UX budget, and the result is exactly the same bytes the
// admin's first poll saw (deterministic re-run against the same source).
//
// Distinguishing fatal vs transient errors so the worker can decide
// whether to retry:
//   - `EngineFatalError` ("source missing", "csv unparseable", "mapping
//     incoherent") → worker throws UnrecoverableError so BullMQ does NOT
//     retry. Three attempts of a missing file is just three log noises.
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

// What the engine returns. `good` and `bad` are the COMPLETE accumulators
// (the worker slices the first 50 of each for previewSnapshot; the
// bad-rows download emits all of `bad`). `totalRows` is the count of
// data rows that were actually evaluated — blank rows are not counted
// (same convention as the cp2 preflight: skip-empty-then-count).
export interface EngineResult {
  good: StudentImportRowGood[];
  bad: StudentImportRowError[];
  totalRows: number;
  // headers exposed back so the bad-rows download can write them as the
  // CSV header without re-parsing.
  headers: string[];
}

// Parse the persisted ImportJob.columnMapping JSON column back into the
// shape parseStudentImportRow expects. Throws EngineFatalError if the
// column is missing or malformed — neither should happen in practice
// (POST /imports/:jobId/mapping validates it before writing), but the
// engine refuses to silently accept a half-state.
export interface PersistedMapping {
  mapping: Record<string, string | null>;
  options: StudentImportOptions;
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
  // Trust the values shape — applyStudentImportMappingSchema already
  // validated it at write time. We re-narrow defensively just to give
  // a clearer error if something corrupts the column.
  for (const [k, v] of Object.entries(mapping)) {
    if (typeof k !== "string" || (v !== null && typeof v !== "string")) {
      throw new EngineFatalError(
        "mapping_incoherent",
        `ImportJob.columnMapping has malformed entry: ${k} → ${typeof v}.`,
      );
    }
  }
  const opts = options as Partial<StudentImportOptions> | undefined;
  return {
    mapping: mapping as Record<string, string | null>,
    options: {
      dateFormat: opts?.dateFormat ?? "YYYY-MM-DD",
      treatBlankAs: opts?.treatBlankAs ?? "skip",
    },
  };
}

// Main entrypoint. Synchronous CSV parse + per-row validation + dedup,
// runs in O(N) over the data rows plus ONE external dedup query.
//
// The `db` argument MUST be a tenant-scoped PrismaClient (i.e. from
// inside a withTenant callback). The external dedup query relies on RLS
// scoping the student lookup to the current school.
export async function runValidationEngine(
  db: PrismaClient,
  sourceBytes: Buffer,
  mapping: Record<string, string | null>,
  options: StudentImportOptions,
): Promise<EngineResult> {
  let rows: string[][];
  try {
    rows = parseCsv(sourceBytes, {
      bom: true,
      // skip_empty_lines: FALSE in the worker (unlike the cp2 preflight
      // which uses TRUE). We need exact line positions so rowNumber
      // matches the source CSV's data-row offset from the header. A
      // blank row is a line that occupies a rowNumber but we don't
      // emit it as good or bad — see the loop below.
      skip_empty_lines: false,
      trim: false,
      relax_quotes: true,
      // relax_column_count: TRUE so a literal blank line (which parses
      // as `[]` and would otherwise fail csv-parse's strict-length
      // check against the header's column count) is accepted. Per-row
      // short/long-cell handling is done downstream in the validation
      // loop — every CSV row in the wild produces ragged columns
      // somewhere.
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

  // -----------------------------------------------------------------------
  // Per-row parse loop.
  //
  // ROW-NUMBERING: rowNumber is the 1-based DATA row index. The header
  // is row 0 (the first line of the CSV). The first data line — the
  // line directly under the header — is rowNumber 1. A blank line
  // occupies a rowNumber slot but is not emitted as good or bad (it
  // doesn't contribute to validRows or invalidRows either).
  //
  // For an admin opening the CSV in Excel: the bad-rows.csv preserves
  // each bad row's content, so they find it by matching values. The
  // rowNumber field tells them "this is the Nth row below the header
  // in your source file" — useful for a CSV with thousands of rows
  // where Ctrl-F by content might be ambiguous.
  // -----------------------------------------------------------------------
  const good: StudentImportRowGood[] = [];
  const bad: StudentImportRowError[] = [];
  let evaluatedRowCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const rawRow = rows[i];
    // Blank-row detection — every cell is empty or whitespace-only.
    // csv-parse may emit `[]` for a literal "\n" or `["", "", ""]` for
    // ",," — both are blank. Per spec line 935 we skip these without
    // counting them as bad rows or as data rows.
    const isBlank =
      rawRow.length === 0 || rawRow.every((c) => (c ?? "").trim() === "");
    if (isBlank) continue;

    evaluatedRowCount += 1;
    const rowNumber = i; // 1-based data row index (header is at array index 0)

    // Build the object keyed by header so parseStudentImportRow can look
    // up by CSV header name. If a row has fewer cells than headers,
    // missing cells become "" (required-field validation will surface
    // them as errors).
    const csvRow: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      csvRow[headers[h]] = (rawRow[h] ?? "").trim();
    }

    const result = parseStudentImportRow(rowNumber, csvRow, mapping, options);
    if (result.ok) {
      good.push(result.row);
    } else {
      bad.push(result.row);
    }
  }

  // -----------------------------------------------------------------------
  // In-file dedup on admissionNumber.
  //
  // Iterate the good pile in original row order. The FIRST occurrence
  // of an admissionNumber stays good; every subsequent occurrence moves
  // to bad with the earlier row's number in the message — so the admin
  // can find both rows in the source file.
  // -----------------------------------------------------------------------
  const inFileDedupSurvivors: StudentImportRowGood[] = [];
  const seenAdmission = new Map<string, number>();
  for (const g of good) {
    const adm = g.parsedRow.admissionNumber;
    const firstRow = seenAdmission.get(adm);
    if (firstRow !== undefined) {
      bad.push({
        rowNumber: g.rowNumber,
        // Re-derive the csvRow from the parsed row's keys so the bad
        // entry carries the same content. We don't have the original
        // csvRow at this point — the parser discarded it on success.
        // Reconstructing from parsedRow is faithful for everything
        // except dateOfBirth (Date object — we ISO-format it) and
        // gender (already canonicalised).
        csvRow: rebuildCsvRowFromParsed(g.parsedRow),
        errors: [
          {
            field: "admissionNumber",
            message: `Duplicate admission number with row ${firstRow}.`,
          },
        ],
      });
      continue;
    }
    seenAdmission.set(adm, g.rowNumber);
    inFileDedupSurvivors.push(g);
  }

  // -----------------------------------------------------------------------
  // External dedup — ONE query against students.admissionNumber for the
  // tenant (withTenant has already scoped `db` to schoolId via RLS).
  // -----------------------------------------------------------------------
  let externallyTakenSet = new Set<string>();
  if (inFileDedupSurvivors.length > 0) {
    const admissionNumbers = inFileDedupSurvivors.map(
      (g) => g.parsedRow.admissionNumber,
    );
    const existing = await db.student.findMany({
      where: { admissionNumber: { in: admissionNumbers } },
      select: { admissionNumber: true },
    });
    externallyTakenSet = new Set(existing.map((s) => s.admissionNumber));
  }

  const finalGood: StudentImportRowGood[] = [];
  for (const g of inFileDedupSurvivors) {
    if (externallyTakenSet.has(g.parsedRow.admissionNumber)) {
      bad.push({
        rowNumber: g.rowNumber,
        csvRow: rebuildCsvRowFromParsed(g.parsedRow),
        errors: [
          {
            field: "admissionNumber",
            message: "Already exists in roster.",
          },
        ],
      });
    } else {
      finalGood.push(g);
    }
  }

  // Sort bad rows back into original row order — dedup steps appended
  // newly-bad rows at the end. The wizard / download CSV both expect
  // ascending rowNumber order.
  bad.sort((a, b) => a.rowNumber - b.rowNumber);

  return {
    good: finalGood,
    bad,
    totalRows: evaluatedRowCount,
    headers,
  };
}

// Re-derive an object keyed by source-CSV column for a parsed row. Used
// when a row was originally parsed-good but later moved to bad by dedup
// — we discarded the original csvRow at parse success, so we reconstruct
// what we need to print in bad-rows.csv. Field naming uses the schema's
// canonical field names rather than the CSV headers; bad-rows.csv has a
// separate path that writes the ORIGINAL CSV headers, so this is only
// for the previewSnapshot.bad entries the wizard renders inline.
function rebuildCsvRowFromParsed(
  parsed: StudentImportRowGood["parsedRow"],
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

// Serialise bad rows to a CSV string. The header row uses the ORIGINAL
// detected headers (so an admin opening it in Excel sees the same
// columns as their source) plus a final `_errors` column. The body
// re-streams from the source: we need the original CSV row content
// verbatim (not the parsed values which lose formatting / failed-parse
// inputs). The caller passes both the engine result and the raw row
// objects keyed by header — both can be produced by walking source.csv
// once.
//
// We escape CSV cells per RFC 4180: wrap in quotes if the cell contains
// comma, quote, CR, or LF; double internal quotes.
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

// Re-stream the original source CSV to build the (rowNumber, csvRow)
// pairs that bad-rows.csv needs. We re-parse rather than relying on the
// engine's reconstructed-from-parsed rows because the bad entries from
// schema/date/gender failures still carry the ORIGINAL csvRow (the
// parser preserves it on failure) — but the dedup-failures don't. For
// the download we want the source-fidelity row contents always.
export function buildBadRowsFromSource(
  sourceBytes: Buffer,
  bad: StudentImportRowError[],
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
