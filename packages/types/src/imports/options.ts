import { z } from "zod";

// Shared options schema for CSV imports — used by both student and
// guardian imports in Phase 1 (and teacher imports in slice 10). Lives
// here rather than under one resource's folder because the options are
// identical across all import types: a date format (only consumed by
// schemas that have a date column) and a blank-handling policy. The
// guardian import doesn't have a date column today, but the field stays
// on every import's options because:
//   - The mapping wizard renders the date-format radio identically for
//     every import type; only required-field-checks differ.
//   - The validate engine's options-handling code is shared (cp1 slice 8
//     extracted parseSourceCsv). Different options shapes per type would
//     fork that code.
//   - Slice 10's teacher import will reintroduce a date column
//     (joinedAt), so removing dateFormat from the guardian options for
//     one slice and adding it back for the next is churn for no gain.

export const IMPORT_DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const;
export type ImportDateFormat = (typeof IMPORT_DATE_FORMATS)[number];

export const IMPORT_BLANK_HANDLING = ["skip", "error"] as const;
export type ImportBlankHandling = (typeof IMPORT_BLANK_HANDLING)[number];

export const importOptionsSchema = z
  .object({
    dateFormat: z.enum(IMPORT_DATE_FORMATS).default("YYYY-MM-DD"),
    treatBlankAs: z.enum(IMPORT_BLANK_HANDLING).default("skip"),
    // Target term for enrollments created by the student import's class-arm
    // column (2026-08-09; docs/modules/student-import-enrollment.md D3).
    //
    // NOT a per-row CSV cell: every row in one import goes to the same term,
    // and asking an admin to repeat it 300 times is 300 chances to typo it.
    //
    // Deliberately has NO default — an explicit choice is required whenever
    // the classArm column is mapped (approved 2026-08-09, overriding the
    // plan-first's original "default to Term.isCurrent"). A silent default
    // is at its most dangerous exactly when it is most likely to be wrong:
    // a school onboarding mid-transition between terms. The API enforces
    // this as a precondition at mapping-submit, not per row — see
    // ImportsService.
    //
    // Lives on the shared options object (alongside dateFormat) for the same
    // reason dateFormat does: the mapping wizard and the validate engine's
    // options plumbing are shared across student/guardian/teacher imports,
    // and forking them per type costs more than one unused optional field.
    // Guardian and teacher imports simply never set it.
    targetTermId: z.string().uuid().optional(),
  })
  .strict();
export type ImportOptions = z.infer<typeof importOptionsSchema>;
