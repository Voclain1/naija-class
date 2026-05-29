import { z } from "zod";

import {
  type ImportOptions,
  type ImportRowError,
  type ImportRowGood,
} from "../imports/index.js";
import { RELATIONSHIP_VALUES } from "./create-guardian.dto.js";

// CSV-import row schema for Guardian. Slice 8 mirrors the slice-6 Student
// import shape but with three structural differences:
//
//   1. The link column — `studentAdmissionNumber` — is REQUIRED. Every
//      guardian row imports a Guardian + a StudentGuardian link to the
//      named student. The "Guardian without any student link" case
//      doesn't exist in this import; admins use the single-create
//      Guardian endpoint (or the slice 5 student-detail inline form)
//      for that.
//
//   2. Relationship is REQUIRED and uses the same string→enum coercion
//      pattern as Student's gender — admins write "Father", "Mum", "G/M",
//      etc. The synonym table (see parseGuardianRelationship below) is
//      narrower than gender because the relationship is a closer-knit
//      enum.
//
//   3. There's no dateOfBirth or date-typed column today. The shared
//      importOptionsSchema's `dateFormat` field still lives on guardian
//      import jobs (mapping UI renders the radio for symmetry), but it
//      isn't consumed by parseGuardianImportRow. Slice 10 will
//      re-activate it for teacher imports (joinedAt).
//
// `isPrimary` and `canPickup` are link-level fields, not Guardian-level.
// They're still on the CSV row because the admin's mental model is
// "one row = one parent's relationship to one child", which packages
// the Guardian fields + the link fields together. The commit handler
// peels them out: Guardian.create uses firstName/lastName/relationship/
// phone/email/occupation/employer/address/notes; StudentGuardian.create
// uses isPrimary/canPickup.

// Relationship synonyms — narrow because the enum is short and the
// vocabulary settled. Admins writing "Father" / "Mother" / "Guardian" is
// the realistic case; "G/M" or single-letter codes are rare enough to
// require an explicit dropdown override.
const RELATIONSHIP_MAP: Record<string, (typeof RELATIONSHIP_VALUES)[number]> = {
  father: "FATHER",
  dad: "FATHER",
  daddy: "FATHER",
  pa: "FATHER",
  papa: "FATHER",
  f: "FATHER",
  mother: "MOTHER",
  mum: "MOTHER",
  mom: "MOTHER",
  mummy: "MOTHER",
  mommy: "MOTHER",
  ma: "MOTHER",
  mama: "MOTHER",
  m: "MOTHER",
  guardian: "GUARDIAN",
  legalguardian: "GUARDIAN",
  uncle: "UNCLE",
  aunt: "AUNT",
  auntie: "AUNT",
  aunty: "AUNT",
  grandparent: "GRANDPARENT",
  grandmother: "GRANDPARENT",
  grandma: "GRANDPARENT",
  grandfather: "GRANDPARENT",
  grandpa: "GRANDPARENT",
  sibling: "SIBLING",
  brother: "SIBLING",
  sister: "SIBLING",
  other: "OTHER",
};

function parseGuardianRelationship(
  raw: string,
): (typeof RELATIONSHIP_VALUES)[number] | null {
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  return RELATIONSHIP_MAP[key] ?? null;
}

// Boolean coercion — accepts the spread of forms a Nigerian-school CSV
// will throw at us: "Yes/No", "Y/N", "True/False", "1/0", "Primary"/"".
// Empty / unrecognised → undefined so the optional schema applies its
// own default. We deliberately don't fail the row on a weird value;
// instead we treat it as if the cell were blank, and the schema's
// optional+default handles it.
function parseBooleanCell(raw: string): boolean | undefined {
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (["yes", "y", "true", "t", "1"].includes(key)) return true;
  if (["no", "n", "false", "f", "0"].includes(key)) return false;
  return undefined;
}

export const guardianImportRowSchema = z
  .object({
    studentAdmissionNumber: z
      .string()
      .trim()
      .min(1, "student admission number required")
      .max(40),
    firstName: z.string().trim().min(1, "first name required").max(60),
    lastName: z.string().trim().min(1, "last name required").max(60),
    relationship: z.enum(RELATIONSHIP_VALUES, {
      required_error: "relationship required",
      invalid_type_error:
        "relationship must be one of Father, Mother, Guardian, Uncle, Aunt, Grandparent, Sibling, Other",
    }),
    phone: z.string().trim().min(1, "phone required").max(30),
    email: z.string().trim().email().max(254).optional(),
    occupation: z.string().trim().min(1).max(120).optional(),
    employer: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().min(1).max(500).optional(),
    notes: z.string().trim().min(1).max(2000).optional(),
    isPrimary: z.boolean().optional(),
    canPickup: z.boolean().optional(),
  })
  .strict();
export type GuardianImportRow = z.infer<typeof guardianImportRowSchema>;

export type GuardianImportRowError = ImportRowError;
export type GuardianImportRowGood = ImportRowGood<GuardianImportRow>;

// The set of Guardian fields admins can map an inbound CSV column to.
// Keep this in sync with guardianImportRowSchema's keys (the type-level
// assertion at the bottom catches drift at build time).
export const GUARDIAN_IMPORT_TARGET_FIELDS = [
  "studentAdmissionNumber",
  "firstName",
  "lastName",
  "relationship",
  "phone",
  "email",
  "occupation",
  "employer",
  "address",
  "notes",
  "isPrimary",
  "canPickup",
] as const;
export type GuardianImportTargetField =
  (typeof GUARDIAN_IMPORT_TARGET_FIELDS)[number];

export const GUARDIAN_IMPORT_REQUIRED_FIELDS = [
  "studentAdmissionNumber",
  "firstName",
  "lastName",
  "relationship",
  "phone",
] as const satisfies readonly GuardianImportTargetField[];
export type GuardianImportRequiredField =
  (typeof GUARDIAN_IMPORT_REQUIRED_FIELDS)[number];

// Parse one CSV row using the admin's column mapping + options. Returns
// the same discriminated union shape as parseStudentImportRow so the
// engine's per-row loop is uniform across types.
//
// Pre-coerce the type-specific fields (relationship, booleans) BEFORE
// Zod runs; the schema then sees clean values. Same convention as
// parseStudentImportRow's date + gender pre-coercion.
export function parseGuardianImportRow(
  rowNumber: number,
  csvRow: Record<string, string>,
  columnMapping: Record<string, string | null>,
  options: ImportOptions,
):
  | { ok: true; row: GuardianImportRowGood }
  | { ok: false; row: GuardianImportRowError } {
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
      continue;
    }

    if (targetField === "relationship") {
      const parsed = parseGuardianRelationship(trimmed);
      if (!parsed) {
        preErrors.push({
          field: "relationship",
          message: `'${trimmed}' is not a recognised relationship (use Father, Mother, Guardian, Uncle, Aunt, Grandparent, Sibling, Other)`,
        });
        continue;
      }
      collected.relationship = parsed;
    } else if (targetField === "isPrimary" || targetField === "canPickup") {
      const parsed = parseBooleanCell(trimmed);
      if (parsed !== undefined) collected[targetField] = parsed;
      // Unrecognised boolean → treat as blank (omit). Schema's
      // optional+default applies if needed at commit time.
    } else {
      collected[targetField] = trimmed;
    }
  }

  const parseResult = guardianImportRowSchema.safeParse(collected);
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

// Build-time check: every key in guardianImportRowSchema MUST appear in
// GUARDIAN_IMPORT_TARGET_FIELDS. If a future edit adds a key to the
// schema without updating the target-field list (or vice versa),
// TypeScript fails this assertion at typecheck time.
type _SchemaKeys = keyof GuardianImportRow;
type _AssertSchemaKeysAreTargetFields =
  Exclude<_SchemaKeys, GuardianImportTargetField> extends never ? true : never;
type _AssertTargetFieldsAreSchemaKeys =
  Exclude<GuardianImportTargetField, _SchemaKeys> extends never ? true : never;
const _schemaTargetFieldsAlignmentCheck: _AssertSchemaKeysAreTargetFields &
  _AssertTargetFieldsAreSchemaKeys = true;
void _schemaTargetFieldsAlignmentCheck;
