import type { PrismaClient } from "@school-kit/db";
import {
  parseGuardianImportRow,
  type GuardianImportRow,
  type GuardianImportRowError,
  type GuardianImportRowGood,
  type ImportOptions,
} from "@school-kit/types";

import {
  parseSourceCsv,
  rebuildCsvRowFromParsed,
  type EngineResult,
} from "./validate.engine";

// Guardian validate engine. Slice 8 — semantics differ from the student
// engine in three load-bearing ways:
//
// 1. DEDUP KEY. Spec at phase-1.md:949 says "exact-match on phone +
//    lastName". Implementation uses (phone + firstName + lastName)
//    instead because slice 5's schema comment at schema.prisma:438-442
//    explicitly anticipates "a mother and father commonly share a
//    household phone" — and they'd share lastName too. Spec key
//    collapses Mr. + Mrs. Okonkwo at the same number into ONE Guardian
//    (wrong data). Adding firstName to the key is the same query cost
//    and correctly distinguishes parents. Flagged in cp1 report.
//
// 2. IN-FILE DEDUP IS A MERGE, NOT A REJECT. The "sibling case" — one
//    parent with two children — is naturally expressed as two CSV rows
//    with identical guardianKey (phone+first+last) but different
//    studentAdmissionNumber. We do NOT mark the second row as bad; the
//    commit handler's find-or-create on Guardian re-uses the existing
//    Guardian and creates a second StudentGuardian link.
//
//    The IN-FILE dedup that DOES reject is on the FULL tuple
//    (guardianKey + studentAdmissionNumber): if the admin types two
//    rows that produce the same Guardian + same Student link, the
//    second is bad with "Duplicate guardian-student link with row N".
//    The StudentGuardian @@unique([studentId, guardianId]) constraint
//    would catch this at commit-time anyway, but pre-empting at
//    validate keeps the per-row error attribution clean.
//
//    When two rows share a guardianKey but disagree on relationship,
//    the FIRST row's relationship wins (the commit's find-or-create
//    returns the existing Guardian and ignores subsequent rows'
//    Guardian-level fields). Same first-row-wins logic as
//    distributed-systems merge conflicts. Flagged in cp1 report.
//
// 3. EXTERNAL CHECK POLARITY IS REVERSED. For students, external dedup
//    rejects rows whose admissionNumber ALREADY exists. For guardians,
//    we reject rows whose studentAdmissionNumber DOESN'T exist — the
//    link target must resolve to a real Student in this school. Bad
//    row message: "Student admission number not found" (per spec line
//    949). The Guardian itself can already exist (commit-side find-
//    or-create handles that); only the Student-link target gates here.
//
// `db` MUST be tenant-scoped (from inside withTenant). The Student
// lookup relies on RLS scoping to the current school.

// Dedup key for a Guardian row. (phone + firstName + lastName), all
// normalised (trim + lowercase) so "Okonkwo" and "okonkwo" collapse.
function guardianKey(row: GuardianImportRow): string {
  return `${row.phone.trim().toLowerCase()}|${row.firstName.trim().toLowerCase()}|${row.lastName.trim().toLowerCase()}`;
}

// Full link key = guardianKey + admission number. Two CSV rows producing
// the same value would create a P2002 on StudentGuardian at commit time.
function linkKey(row: GuardianImportRow): string {
  return `${guardianKey(row)}|${row.studentAdmissionNumber.trim().toLowerCase()}`;
}

export async function runGuardianValidationEngine(
  db: PrismaClient,
  sourceBytes: Buffer,
  mapping: Record<string, string | null>,
  options: ImportOptions,
): Promise<EngineResult<GuardianImportRow>> {
  const {
    headers,
    good: parsed,
    bad,
    evaluatedRowCount,
  } = parseSourceCsv<GuardianImportRow>(
    sourceBytes,
    mapping,
    options,
    parseGuardianImportRow,
  );

  // -----------------------------------------------------------------------
  // In-file dedup on the FULL link tuple (guardianKey + admissionNumber).
  // Same-guardian-different-students (the sibling case) survives both
  // rows. Same-guardian-same-student → second is bad.
  // -----------------------------------------------------------------------
  const inFileSurvivors: GuardianImportRowGood[] = [];
  const seenLink = new Map<string, number>();
  for (const g of parsed) {
    const key = linkKey(g.parsedRow);
    const firstRow = seenLink.get(key);
    if (firstRow !== undefined) {
      bad.push({
        rowNumber: g.rowNumber,
        csvRow: rebuildCsvRowFromParsed(
          g.parsedRow as unknown as Record<string, unknown>,
        ),
        errors: [
          {
            field: "studentAdmissionNumber",
            message: `Duplicate guardian-student link with row ${firstRow}.`,
          },
        ],
      });
      continue;
    }
    seenLink.set(key, g.rowNumber);
    inFileSurvivors.push(g);
  }

  // -----------------------------------------------------------------------
  // External resolution of studentAdmissionNumber → Student. ONE query.
  // Rows whose admissionNumber doesn't resolve are moved to bad.
  // -----------------------------------------------------------------------
  let resolvableAdmissionNumbers = new Set<string>();
  if (inFileSurvivors.length > 0) {
    const admissionNumbers = [
      ...new Set(inFileSurvivors.map((g) => g.parsedRow.studentAdmissionNumber)),
    ];
    const existing = await db.student.findMany({
      where: { admissionNumber: { in: admissionNumbers } },
      select: { admissionNumber: true },
    });
    resolvableAdmissionNumbers = new Set(
      existing.map((s) => s.admissionNumber),
    );
  }

  const finalGood: GuardianImportRowGood[] = [];
  for (const g of inFileSurvivors) {
    if (!resolvableAdmissionNumbers.has(g.parsedRow.studentAdmissionNumber)) {
      bad.push({
        rowNumber: g.rowNumber,
        csvRow: rebuildCsvRowFromParsed(
          g.parsedRow as unknown as Record<string, unknown>,
        ),
        errors: [
          {
            field: "studentAdmissionNumber",
            message: "Student admission number not found.",
          },
        ],
      });
    } else {
      finalGood.push(g);
    }
  }

  // Sort bad rows back into original row order — dedup steps appended at
  // the end. The wizard / download CSV expect ascending rowNumber order.
  bad.sort(
    (a: GuardianImportRowError, b: GuardianImportRowError) =>
      a.rowNumber - b.rowNumber,
  );

  return {
    good: finalGood,
    bad,
    totalRows: evaluatedRowCount,
    headers,
  };
}
