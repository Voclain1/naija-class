import type { PrismaClient } from "@school-kit/db";
import {
  parseTeacherImportRow,
  type ImportOptions,
  type TeacherImportRow,
  type TeacherImportRowError,
  type TeacherImportRowGood,
} from "@school-kit/types";

import {
  parseSourceCsv,
  rebuildCsvRowFromParsed,
  type EngineResult,
} from "./validate.engine";

// Teacher validate engine (slice 10 cp2). The third application of the
// slice-6/8 pattern. Two dedup/validation phases on top of the shared
// parseSourceCsv:
//
//   1. IN-FILE DEDUP ON EMAIL. The key is the parsed `email`, which the
//      schema has already trimmed + lowercased — so dedup is
//      case-insensitive for free ("Ada@x.com" and "ada@x.com" collapse).
//      First occurrence stays good; a later row with the same email is
//      moved to bad with "Duplicate email with row N". Rationale: one
//      email = one human = one invitation. Two CSV rows for the same
//      address are an admin typo, not two teachers — and creating two
//      invitations for one email would be confusing (which link is live?).
//
//   2. EXTERNAL CHECK — email already a User in this school. ONE query
//      against users.email for the tenant (withTenant scopes via RLS),
//      matching active AND inactive users (a deactivated teacher's email
//      is still taken; re-inviting them is a reactivate flow, not an
//      import). Any good row whose email already exists is moved to bad
//      with "User already exists with this email".
//
// Note the external POLARITY vs students: students reject admission
// numbers that ALREADY exist (same as teachers reject existing emails),
// whereas guardians reject admission numbers that DON'T exist. Teachers
// follow the student polarity.
//
// What this engine deliberately does NOT check: an already-PENDING
// invitation for the email. That's a commit-time guard in
// commit-teachers.row.ts (a pending invitation isn't a User yet, so it
// wouldn't show up here, and it's the rarer case — mirrors guardians'
// split, where "link already exists" is also a commit-time check).
//
// `db` MUST be tenant-scoped (from inside withTenant) — the external User
// lookup relies on RLS scoping to the current school.

export async function runTeacherValidationEngine(
  db: PrismaClient,
  sourceBytes: Buffer,
  mapping: Record<string, string | null>,
  options: ImportOptions,
): Promise<EngineResult<TeacherImportRow>> {
  const {
    headers,
    good: parsed,
    bad,
    evaluatedRowCount,
  } = parseSourceCsv<TeacherImportRow>(
    sourceBytes,
    mapping,
    options,
    parseTeacherImportRow,
  );

  // -----------------------------------------------------------------------
  // In-file dedup on email (already lowercased by the schema).
  // -----------------------------------------------------------------------
  const inFileSurvivors: TeacherImportRowGood[] = [];
  const seenEmail = new Map<string, number>();
  for (const g of parsed) {
    const email = g.parsedRow.email;
    const firstRow = seenEmail.get(email);
    if (firstRow !== undefined) {
      bad.push({
        rowNumber: g.rowNumber,
        // The parser discarded the original csvRow on success; rebuild
        // from the parsed payload for the preview UI. The bad-rows
        // download re-streams the verbatim source row separately.
        csvRow: rebuildCsvRowFromParsed(
          g.parsedRow as unknown as Record<string, unknown>,
        ),
        errors: [
          {
            field: "email",
            message: `Duplicate email with row ${firstRow}.`,
          },
        ],
      });
      continue;
    }
    seenEmail.set(email, g.rowNumber);
    inFileSurvivors.push(g);
  }

  // -----------------------------------------------------------------------
  // External check — email already a User (active or inactive). ONE query.
  // -----------------------------------------------------------------------
  let existingEmailSet = new Set<string>();
  if (inFileSurvivors.length > 0) {
    const emails = inFileSurvivors.map((g) => g.parsedRow.email);
    const existing = await db.user.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    existingEmailSet = new Set(
      // User.email is nullable in the schema; the filter keeps TS happy
      // and is a no-op in practice (every row we match has an email).
      existing
        .map((u) => u.email)
        .filter((e): e is string => e !== null),
    );
  }

  const finalGood: TeacherImportRowGood[] = [];
  for (const g of inFileSurvivors) {
    if (existingEmailSet.has(g.parsedRow.email)) {
      bad.push({
        rowNumber: g.rowNumber,
        csvRow: rebuildCsvRowFromParsed(
          g.parsedRow as unknown as Record<string, unknown>,
        ),
        errors: [
          {
            field: "email",
            message: "User already exists with this email.",
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
    (a: TeacherImportRowError, b: TeacherImportRowError) =>
      a.rowNumber - b.rowNumber,
  );

  return {
    good: finalGood,
    bad,
    totalRows: evaluatedRowCount,
    headers,
  };
}
