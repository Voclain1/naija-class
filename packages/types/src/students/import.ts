import { z } from "zod";

import {
  type ImportDateFormat,
  type ImportOptions,
  type ImportRowError,
  type ImportRowGood,
} from "../imports/index.js";

// CSV-import row schema for Student. Used by the validate worker in slice 6
// to parse rows from a school's CSV, and by the slice-7 commit worker to
// re-validate before insert.
//
// Why a separate schema rather than re-using createStudentSchema:
//   - CSV values arrive as strings only; the create schema accepts ISO
//     dates and enum literals because the JSON controller already
//     converted them. The import path has to *coerce* from raw CSV text.
//   - The error reporting shape we need is per-row, with the row number
//     and the raw CSV row preserved alongside the issues — see
//     parseStudentImportRow below. The DTO schemas elsewhere just throw
//     ZodError; that's wrong for imports because we keep going.
//   - The date format is admin-selected at mapping time (DD/MM/YYYY,
//     MM/DD/YYYY, or YYYY-MM-DD). The create schema can't know that.
//
// The schema is intentionally narrower than createStudentSchema during
// CSV import: only the fields a school is realistically going to put
// into a CSV are accepted. `medicalNotes`, `notes`, and other free-text
// fields stay out of v1 of this schema — admins capture those by hand.
// (Adding a field later is purely additive — no migration needed.)
//
// `nationality` is also intentionally NOT exposed in the import: the DB
// default ("Nigerian") covers the realistic case and dropping the column
// reduces the chance of a mis-mapped header.
//
// Slice 8 extraction: the options schema + date-format / blank-handling
// constants live in ../imports/options.ts because they're identical across
// student + guardian imports (and teacher imports in slice 10). The aliases
// below keep the slice-6 names (StudentImportOptions, etc.) working as
// re-exports so existing call sites don't have to change.

// Type aliases — the slice 6 names map to the shared shapes from
// ../imports/. These are TYPE-ONLY re-exports (erased at runtime) so
// they don't introduce a circular-require chain with apply-mapping.dto.ts
// (which lives under ../imports/ and references STUDENT_IMPORT_TARGET_FIELDS
// from THIS file). Slice 8 hit that circular bug: the value-level
// `export { X as Y } from "../imports/index.js"` created a runtime
// require that landed apply-mapping.dto.js BEFORE students/import.js
// finished defining its constants, producing schemas with z.enum(undefined).
//
// Slice-6 callsites using STUDENT_IMPORT_DATE_FORMATS / studentImportOptionsSchema
// at VALUE level (one site in apps/web; see the slice 8 cp1 update) now
// import from "@school-kit/types"'s IMPORT_DATE_FORMATS / importOptionsSchema
// directly.
export type StudentImportDateFormat = ImportDateFormat;
export type StudentImportBlankHandling = "skip" | "error";
export type StudentImportOptions = ImportOptions;

// Gender accepted forms — kept here (not in createStudentSchema) because
// the create endpoint only accepts the canonical enum literals; CSVs in
// the wild have "M", "Male", "male", etc.
const GENDER_MAP: Record<string, "MALE" | "FEMALE" | "OTHER"> = {
  m: "MALE", male: "MALE", boy: "MALE",
  f: "FEMALE", female: "FEMALE", girl: "FEMALE",
  o: "OTHER", other: "OTHER",
};

function parseGender(raw: string): "MALE" | "FEMALE" | "OTHER" | null {
  const key = raw.trim().toLowerCase();
  return GENDER_MAP[key] ?? null;
}

// Date parsing without pulling in a heavy dep. Strict format match — we
// refuse anything that doesn't fit the chosen pattern, even if JS' Date
// would happily coerce it (Date.parse('foo') leaks NaN, not a throw).
function parseDate(raw: string, format: StudentImportDateFormat): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let y: number, mo: number, d: number;
  if (format === "YYYY-MM-DD") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!m) return null;
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if (format === "DD/MM/YYYY") {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    // MM/DD/YYYY
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
    if (!m) return null;
    [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  // Validate calendar correctness (no Feb 30, no month 13). Constructing
  // a UTC date and asking it back catches overflow.
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

// The schema for a single PARSED row. Inputs are already strings from the
// CSV; this schema coerces them to the same shape as CreateStudentInput's
// subset we accept on import.
//
// Note that we pre-coerce dateOfBirth and gender BEFORE Zod runs (because
// they depend on the admin-chosen dateFormat / synonym table). The schema
// then receives clean Date / enum values. This keeps the Zod schema focused
// on shape validation, not parsing tricks.
export const studentImportRowSchema = z
  .object({
    admissionNumber: z.string().trim().min(1, "admission number required").max(40),
    firstName: z.string().trim().min(1, "first name required").max(60),
    middleName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1, "last name required").max(60),
    dateOfBirth: z.date({
      required_error: "date of birth required",
      invalid_type_error: "date of birth could not be parsed using the chosen format",
    }),
    gender: z.enum(["MALE", "FEMALE", "OTHER"], {
      required_error: "gender required",
      invalid_type_error:
        "gender must be one of M, F, Male, Female, Other (case-insensitive)",
    }),
    phone: z.string().trim().min(1).max(30).optional(),
    email: z.string().trim().email().max(254).optional(),
    address: z.string().trim().min(1).max(500).optional(),
    photoUrl: z.string().trim().url().max(500).optional(),
    bloodGroup: z.string().trim().min(1).max(10).optional(),
    religion: z.string().trim().min(1).max(40).optional(),
    stateOfOrigin: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export type StudentImportRow = z.infer<typeof studentImportRowSchema>;

// Slice 8 extraction: the row-result shapes are now ImportRowError +
// ImportRowGood<Row> in ../imports/row.ts (generic over the parsed-row
// payload so guardian + teacher imports can reuse the same accumulator
// shape). The Student-prefixed aliases below preserve slice-6 callsites.
export type StudentImportRowError = ImportRowError;
export type StudentImportRowGood = ImportRowGood<StudentImportRow>;

// Parse one CSV row using the admin's column mapping + options. Returns a
// discriminated union so the worker accumulator can fan results into the
// good and bad piles without try/catch on Zod errors.
//
// `columnMapping` maps the CSV header → schema field (or null for "do not
// import"). Multiple headers mapping to the same field is a controller-
// level error (caught at mapping submission); this function trusts what
// it's given and uses the *last* mapping that wins for any given field.
//
// `treatBlankAs` decides how blanks are handled for OPTIONAL fields:
//   - "skip" (default): blank => field is omitted from the parsed row
//   - "error": blank => a row error with field name. Required fields are
//     always errors regardless of this setting.
export function parseStudentImportRow(
  rowNumber: number,
  csvRow: Record<string, string>,
  columnMapping: Record<string, string | null>,
  options: StudentImportOptions,
): { ok: true; row: StudentImportRowGood } | { ok: false; row: StudentImportRowError } {
  const collected: Record<string, unknown> = {};
  const preErrors: Array<{ field: string; message: string }> = [];

  // Walk the mapping rather than the row keys: a CSV that's missing
  // a mapped column should error with "field required", not silently
  // omit it.
  for (const [csvHeader, targetField] of Object.entries(columnMapping)) {
    if (!targetField) continue; // unmapped column
    const raw = csvRow[csvHeader];
    const trimmed = (raw ?? "").trim();

    if (trimmed === "") {
      // Required field handling happens in the schema itself (z.string().min(1)).
      // The treatBlankAs setting only affects how OPTIONAL blanks are handled.
      if (options.treatBlankAs === "error") {
        preErrors.push({
          field: targetField,
          message: `blank value not permitted (treatBlankAs=error)`,
        });
      }
      // Otherwise: omit the field. Required fields will surface as
      // schema errors below.
      continue;
    }

    if (targetField === "dateOfBirth") {
      const parsed = parseDate(trimmed, options.dateFormat);
      if (!parsed) {
        preErrors.push({
          field: "dateOfBirth",
          message: `could not parse '${trimmed}' as ${options.dateFormat}`,
        });
        continue;
      }
      collected.dateOfBirth = parsed;
    } else if (targetField === "gender") {
      const parsed = parseGender(trimmed);
      if (!parsed) {
        preErrors.push({
          field: "gender",
          message: `'${trimmed}' is not a recognised gender (use M, F, Male, Female, Other)`,
        });
        continue;
      }
      collected.gender = parsed;
    } else {
      collected[targetField] = trimmed;
    }
  }

  const parseResult = studentImportRowSchema.safeParse(collected);
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

// The set of Student fields admins can map an inbound CSV column to.
// Used by the UI to populate the dropdowns and by the API to validate
// the submitted mapping. Keep this in sync with studentImportRowSchema's
// keys (TypeScript flag below catches drift at build time).
export const STUDENT_IMPORT_TARGET_FIELDS = [
  "admissionNumber",
  "firstName",
  "middleName",
  "lastName",
  "dateOfBirth",
  "gender",
  "phone",
  "email",
  "address",
  "photoUrl",
  "bloodGroup",
  "religion",
  "stateOfOrigin",
] as const;
export type StudentImportTargetField = (typeof STUDENT_IMPORT_TARGET_FIELDS)[number];

export const STUDENT_IMPORT_REQUIRED_FIELDS = [
  "admissionNumber",
  "firstName",
  "lastName",
  "dateOfBirth",
  "gender",
] as const satisfies readonly StudentImportTargetField[];
export type StudentImportRequiredField = (typeof STUDENT_IMPORT_REQUIRED_FIELDS)[number];

// Build-time check: every key in studentImportRowSchema MUST appear in
// STUDENT_IMPORT_TARGET_FIELDS. If a future edit adds a key to the schema
// without updating the target-field list (or vice versa), TypeScript will
// fail this assertion at the package's typecheck step.
type _SchemaKeys = keyof StudentImportRow;
type _AssertSchemaKeysAreTargetFields =
  Exclude<_SchemaKeys, StudentImportTargetField> extends never ? true : never;
type _AssertTargetFieldsAreSchemaKeys =
  Exclude<StudentImportTargetField, _SchemaKeys> extends never ? true : never;
const _schemaTargetFieldsAlignmentCheck: _AssertSchemaKeysAreTargetFields &
  _AssertTargetFieldsAreSchemaKeys = true;
void _schemaTargetFieldsAlignmentCheck;
