import type { PrismaClient } from "@school-kit/db";
import {
  parseStudentImportRow,
  type ImportOptions,
  type StudentImportRow,
  type StudentImportRowError,
  type StudentImportRowGood,
} from "@school-kit/types";

import {
  parseSourceCsv,
  rebuildCsvRowFromParsed,
  type EngineResult,
} from "./validate.engine";

// Student validate engine. Slice 6 owned this pipeline; slice 8 extracted
// the shared CSV-parse loop into validate.engine.ts/parseSourceCsv, so
// what's left here is the two student-specific dedup phases:
//
//   1. In-file dedup on admissionNumber. First occurrence stays good;
//      subsequent occurrences are moved to bad with the earlier row
//      number in the message — admin can find both rows in the source.
//   2. External dedup. ONE query against students.admissionNumber for
//      the tenant (withTenant scopes by RLS); any good row whose
//      admission number already exists is moved to bad with
//      "Already exists in roster".
//
// The `db` argument MUST be a tenant-scoped PrismaClient (i.e. from
// inside a withTenant callback). The external dedup query relies on
// RLS scoping the student lookup to the current school.
export async function runStudentValidationEngine(
  db: PrismaClient,
  sourceBytes: Buffer,
  mapping: Record<string, string | null>,
  options: ImportOptions,
): Promise<EngineResult<StudentImportRow>> {
  const {
    headers,
    good: parsed,
    bad,
    evaluatedRowCount,
  } = parseSourceCsv<StudentImportRow>(
    sourceBytes,
    mapping,
    options,
    parseStudentImportRow,
  );

  // -----------------------------------------------------------------------
  // In-file dedup on admissionNumber.
  // -----------------------------------------------------------------------
  const inFileDedupSurvivors: StudentImportRowGood[] = [];
  const seenAdmission = new Map<string, number>();
  for (const g of parsed) {
    const adm = g.parsedRow.admissionNumber;
    const firstRow = seenAdmission.get(adm);
    if (firstRow !== undefined) {
      bad.push({
        rowNumber: g.rowNumber,
        // The parser discarded the original csvRow on success; rebuild
        // from the parsed payload for the preview UI. (The bad-rows
        // download endpoint uses buildBadRowsFromSource to recover the
        // verbatim source row content.)
        csvRow: rebuildCsvRowFromParsed(
          g.parsedRow as unknown as Record<string, unknown>,
        ),
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
  // tenant. withTenant scopes via RLS.
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
        csvRow: rebuildCsvRowFromParsed(
          g.parsedRow as unknown as Record<string, unknown>,
        ),
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
  // newly-bad rows at the end. The wizard / download CSV expect ascending
  // rowNumber order.
  bad.sort(
    (a: StudentImportRowError, b: StudentImportRowError) =>
      a.rowNumber - b.rowNumber,
  );

  return {
    good: finalGood,
    bad,
    totalRows: evaluatedRowCount,
    headers,
  };
}
