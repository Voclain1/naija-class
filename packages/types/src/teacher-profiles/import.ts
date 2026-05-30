import { z } from "zod";

import {
  type ImportOptions,
  type ImportRowError,
  type ImportRowGood,
} from "../imports/index.js";

// CSV-import row schema for TEACHER invitations (slice 10 cp2). The third
// application of the slice-6/8 import engine. Structurally the SIMPLEST of
// the three import types:
//
//   - Three fields, all REQUIRED: email, firstName, lastName. No optional
//     fields in scope this cp.
//   - No type-specific coercion (no date column, no enum, no booleans) —
//     parseTeacherImportRow just collects trimmed strings and validates
//     shape. The shared importOptionsSchema still rides along (the mapping
//     wizard renders the date-format radio for symmetry) but dateFormat is
//     never consumed here, same as the guardian import.
//
// Why this import creates Invitations, not TeacherProfiles (Q2 lifecycle,
// locked 2026-05-30): the teacher CSV is invite-only. Each good row becomes
// ONE Invitation with roleKey="teacher" (reusing the Phase 0 invitation
// infra). staffNumber / specialty are NOT in the CSV — the Invitation row
// can't carry them (phase-1.md:478), and the admin fills the TeacherProfile
// in after the teacher accepts. Importing profile fields is deferred (see
// docs/deferred.md).
//
// File location follows the per-module convention (students/import.ts,
// guardians/import.ts) — teacher-profiles is the teacher types module from
// cp1. apply-mapping.dto.ts imports the target-field constants from here,
// same as it does for student + guardian.
//
// `email` is lowercased + trimmed at the schema layer so it matches how the
// rest of the system stores emails (inviteAdminSchema, signup). This makes
// the in-file dedup (by email) and the external User-exists check
// case-insensitive for free.

export const teacherImportRowSchema = z
  .object({
    email: z
      .string({ required_error: "email required" })
      .trim()
      .toLowerCase()
      .email("email must be a valid email address")
      .max(254),
    firstName: z
      .string({ required_error: "firstName required" })
      .trim()
      .min(1, "firstName required")
      .max(60),
    lastName: z
      .string({ required_error: "lastName required" })
      .trim()
      .min(1, "lastName required")
      .max(60),
  })
  .strict();
export type TeacherImportRow = z.infer<typeof teacherImportRowSchema>;

export type TeacherImportRowError = ImportRowError;
export type TeacherImportRowGood = ImportRowGood<TeacherImportRow>;

// The set of teacher fields admins can map an inbound CSV column to. Keep in
// sync with teacherImportRowSchema's keys (the type-level assertion at the
// bottom catches drift at build time).
export const TEACHER_IMPORT_TARGET_FIELDS = [
  "email",
  "firstName",
  "lastName",
] as const;
export type TeacherImportTargetField =
  (typeof TEACHER_IMPORT_TARGET_FIELDS)[number];

// All three fields are required — there are no optional teacher import
// fields in cp2.
export const TEACHER_IMPORT_REQUIRED_FIELDS = [
  "email",
  "firstName",
  "lastName",
] as const satisfies readonly TeacherImportTargetField[];
export type TeacherImportRequiredField =
  (typeof TEACHER_IMPORT_REQUIRED_FIELDS)[number];

// Parse one CSV row using the admin's column mapping + options. Returns the
// same discriminated union shape as parseStudentImportRow /
// parseGuardianImportRow so the engine's per-row loop is uniform across
// types. No pre-coercion step — teacher fields are plain strings (email is
// lowercased inside the schema's transform).
export function parseTeacherImportRow(
  rowNumber: number,
  csvRow: Record<string, string>,
  columnMapping: Record<string, string | null>,
  options: ImportOptions,
):
  | { ok: true; row: TeacherImportRowGood }
  | { ok: false; row: TeacherImportRowError } {
  const collected: Record<string, unknown> = {};
  const preErrors: Array<{ field: string; message: string }> = [];

  for (const [csvHeader, targetField] of Object.entries(columnMapping)) {
    if (!targetField) continue;
    const raw = csvRow[csvHeader];
    const trimmed = (raw ?? "").trim();

    if (trimmed === "") {
      if (options.treatBlankAs === "error") {
        preErrors.push({
          field: targetField,
          message: `blank value not permitted (treatBlankAs=error)`,
        });
      }
      // Otherwise omit — required fields surface as schema errors below.
      continue;
    }

    collected[targetField] = trimmed;
  }

  const parseResult = teacherImportRowSchema.safeParse(collected);
  if (!parseResult.success) {
    const zodErrors = parseResult.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? String(issue.path[0]) : "(row)",
      message: issue.message,
    }));
    const allErrors = [...preErrors, ...zodErrors];
    return { ok: false, row: { rowNumber, csvRow, errors: allErrors } };
  }
  if (preErrors.length > 0) {
    return { ok: false, row: { rowNumber, csvRow, errors: preErrors } };
  }
  return { ok: true, row: { rowNumber, parsedRow: parseResult.data } };
}

// Build-time check: every key in teacherImportRowSchema MUST appear in
// TEACHER_IMPORT_TARGET_FIELDS, and vice versa. Drift fails the package
// typecheck.
type _SchemaKeys = keyof TeacherImportRow;
type _AssertSchemaKeysAreTargetFields =
  Exclude<_SchemaKeys, TeacherImportTargetField> extends never ? true : never;
type _AssertTargetFieldsAreSchemaKeys =
  Exclude<TeacherImportTargetField, _SchemaKeys> extends never ? true : never;
const _schemaTargetFieldsAlignmentCheck: _AssertSchemaKeysAreTargetFields &
  _AssertTargetFieldsAreSchemaKeys = true;
void _schemaTargetFieldsAlignmentCheck;
