import { z } from "zod";

// Reviewed student-record corrections (2026-11-09, docs/modules/student-corrections.md).
//
//   PREPARE  POST /student-corrections/proposals              -> a named before/after preview
//   STATUS   GET  /student-corrections/proposals/:id          -> preview, or outcome once confirmed
//   CONFIRM  POST /student-corrections/proposals/:id/confirm  -> applies the batch once
//   REFRESH  POST /student-corrections/proposals/:id/refresh  -> a new preview from the same patches
//
// Six fields only: first, middle and last name, date of birth, gender, email.
// Not here, by design: admission numbers, status, enrolments, guardians,
// credentials, health, behaviour, grades, money, deletion. PATCH /students/:id
// is unchanged. No model is involved.

export const STUDENT_CORRECTION_KIND = "student-correction";
export const STUDENT_CORRECTION_TTL_MINUTES = 30;
export const MAX_STUDENT_CORRECTIONS = 100;

export const STUDENT_CORRECTION_FIELDS = ["firstName", "middleName", "lastName", "dateOfBirth", "gender", "email"] as const;
export type StudentCorrectionField = (typeof STUDENT_CORRECTION_FIELDS)[number];

/** A YYYY-MM-DD calendar date (the column is DATE; no time, no zone). */
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Not a real calendar date.");

/**
 * The patch for one student. A key that is ABSENT leaves that field
 * unchanged. For the two optional fields, `null` CLEARS the value; for the
 * required fields `null` is invalid. An empty patch is invalid.
 */
export const studentCorrectionChangesSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    middleName: z.string().trim().min(1).max(60).nullable(),
    lastName: z.string().trim().min(1).max(60),
    dateOfBirth: calendarDate,
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    email: z.string().trim().toLowerCase().email().max(254).nullable(),
  })
  .partial()
  .strict()
  .refine((c) => Object.keys(c).length > 0, "Give at least one field to change.");
export type StudentCorrectionChanges = z.infer<typeof studentCorrectionChangesSchema>;

export const prepareStudentCorrectionsSchema = z
  .object({
    /** A UUID made once per batch; reused on retries of this prepare. */
    clientRequestId: z.string().uuid(),
    corrections: z
      .array(z.object({ studentId: z.string().uuid(), changes: studentCorrectionChangesSchema }).strict())
      .min(1)
      .max(MAX_STUDENT_CORRECTIONS)
      .refine((rows) => new Set(rows.map((r) => r.studentId)).size === rows.length, "Each student may appear once."),
  })
  .strict();
export type PrepareStudentCorrectionsInput = z.infer<typeof prepareStudentCorrectionsSchema>;

export const confirmStudentCorrectionsSchema = z.object({ previewHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type ConfirmStudentCorrectionsInput = z.infer<typeof confirmStudentCorrectionsSchema>;

export const refreshStudentCorrectionsSchema = z.object({ clientRequestId: z.string().uuid() }).strict();
export type RefreshStudentCorrectionsInput = z.infer<typeof refreshStudentCorrectionsSchema>;

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export const CORRECTION_ROW_ERROR_CODES = [
  /** Not a student of this school (another school's id reads the same). */
  "STUDENT_NOT_FOUND",
  "DATE_OF_BIRTH_IN_FUTURE",
] as const;
export type CorrectionRowErrorCode = (typeof CORRECTION_ROW_ERROR_CODES)[number];

export const CORRECTION_ROW_WARNING_CODES = [
  /** Every requested value already equals the record: nothing to write for this student. */
  "NO_CHANGE",
  /** The student is withdrawn or graduated; the correction still applies. */
  "STUDENT_NOT_ACTIVE",
  /** Another student of this school has this email. */
  "EMAIL_SHARED",
  /** The new date of birth makes the student younger than 2 or older than 25 today. */
  "DATE_OF_BIRTH_UNUSUAL",
] as const;
export type CorrectionRowWarningCode = (typeof CORRECTION_ROW_WARNING_CODES)[number];

export interface CorrectionProblem<C extends string> {
  code: C;
  message: string;
}

/**
 * One field of one student. `change`:
 *  - SET: a new value replaces the current one;
 *  - CLEAR: an optional value is removed (the patch said null);
 *  - SAME: the patch named the field, but the value already matches.
 * Fields the patch did not name are not listed: they are unchanged.
 */
export interface StudentCorrectionFieldDto {
  field: StudentCorrectionField;
  before: string | null;
  after: string | null;
  change: "SET" | "CLEAR" | "SAME";
}

export interface StudentCorrectionRowDto {
  index: number;
  studentId: string;
  /** Who this is, as the record says now: the review is by id, shown by name. */
  current: { name: string; admissionNumber: string; status: string } | null;
  fields: StudentCorrectionFieldDto[];
  errors: CorrectionProblem<CorrectionRowErrorCode>[];
  warnings: CorrectionProblem<CorrectionRowWarningCode>[];
}

export type StudentCorrectionStatus = "PENDING" | "COMPLETED" | "EXPIRED";

export interface StudentCorrectionOutcomeDto {
  /** Students actually written (rows with NO_CHANGE are not). */
  updatedCount: number;
  students: { studentId: string; changed: StudentCorrectionField[] }[];
}

export interface StudentCorrectionProposalDto {
  id: string;
  status: StudentCorrectionStatus;
  previewHash: string;
  expiresAt: string;
  createdAt: string;
  confirmedAt: string | null;
  counts: { rows: number; withErrors: number; withWarnings: number; toUpdate: number; fieldChanges: number; clears: number };
  batchErrors: CorrectionProblem<"NOTHING_TO_APPLY">[];
  canConfirm: boolean;
  /** Present while PENDING; empty once COMPLETED or EXPIRED (values cleared). */
  rows: StudentCorrectionRowDto[];
  dataCleared: boolean;
  outcome: StudentCorrectionOutcomeDto | null;
}

export const STUDENT_CORRECTION_CONFLICT_CODES = {
  previewMismatch: "CORRECTION_PREVIEW_MISMATCH",
  /** A record changed since the review (by anyone, any field shown). Refresh. */
  stale: "CORRECTION_PREVIEW_STALE",
  expired: "CORRECTION_EXPIRED",
  blocked: "CORRECTION_BLOCKED",
  alreadyConfirmed: "CORRECTION_ALREADY_CONFIRMED",
  requestIdReused: "CORRECTION_REQUEST_ID_REUSED",
  retry: "CORRECTION_RETRY",
} as const;
