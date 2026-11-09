import type { PrismaClient } from "@school-kit/db";
import {
  STUDENT_CORRECTION_FIELDS,
  type CorrectionProblem,
  type CorrectionRowErrorCode,
  type CorrectionRowWarningCode,
  type PrepareStudentCorrectionsInput,
  type StudentCorrectionChanges,
  type StudentCorrectionField,
  type StudentCorrectionFieldDto,
  type StudentCorrectionProposalDto,
  type StudentCorrectionRowDto,
} from "@school-kit/types";

import { fingerprint } from "../../common/workflow/fingerprint";

// The authoritative before/after preview of a correction batch
// (docs/modules/student-corrections.md). Computed at prepare, and again inside
// the confirm transaction from the LOCKED rows: the confirm writes only if the
// fingerprint is unchanged. Records are found by id only, never by name.

export type CorrectionRows = PrepareStudentCorrectionsInput["corrections"];

/** The six correctable values of a student as strings, the shape the preview compares. */
export interface StudentSnapshot {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  email: string | null;
  admissionNumber: string;
  status: string;
}

export interface CorrectionPreview {
  rows: StudentCorrectionRowDto[];
  summary: Pick<StudentCorrectionProposalDto, "counts" | "batchErrors">;
  /** Per student, only the fields to write (SET or CLEAR), as DB values. */
  writes: { studentId: string; changed: StudentCorrectionField[]; data: Record<string, string | Date | null> }[];
  previewHash: string;
  canConfirm: boolean;
}

export function snapshotOf(s: {
  id: string; firstName: string; middleName: string | null; lastName: string; dateOfBirth: Date; gender: string;
  email: string | null; admissionNumber: string; status: string;
}): StudentSnapshot {
  return {
    id: s.id, firstName: s.firstName, middleName: s.middleName, lastName: s.lastName,
    dateOfBirth: s.dateOfBirth.toISOString().slice(0, 10), gender: s.gender,
    email: s.email ? s.email.trim().toLowerCase() : null, admissionNumber: s.admissionNumber, status: s.status,
  };
}

/** Reads the batch's students; with `lock`, row-locks them (in id order, so batches cannot deadlock). */
export async function loadSnapshots(db: PrismaClient, schoolId: string, ids: string[], lock: boolean): Promise<Map<string, StudentSnapshot>> {
  const sorted = [...ids].sort();
  const rows = lock
    ? await db.$queryRaw<{ id: string; first_name: string; middle_name: string | null; last_name: string; date_of_birth: Date; gender: string; email: string | null; admission_number: string; status: string }[]>`
        SELECT id, first_name, middle_name, last_name, date_of_birth, gender::text AS gender, email, admission_number, status::text AS status
          FROM students WHERE school_id = ${schoolId} AND id = ANY(${sorted}::text[]) ORDER BY id FOR UPDATE`
    : await db.$queryRaw<{ id: string; first_name: string; middle_name: string | null; last_name: string; date_of_birth: Date; gender: string; email: string | null; admission_number: string; status: string }[]>`
        SELECT id, first_name, middle_name, last_name, date_of_birth, gender::text AS gender, email, admission_number, status::text AS status
          FROM students WHERE school_id = ${schoolId} AND id = ANY(${sorted}::text[])`;
  return new Map(
    rows.map((r) => [
      r.id,
      snapshotOf({
        id: r.id, firstName: r.first_name, middleName: r.middle_name, lastName: r.last_name, dateOfBirth: r.date_of_birth,
        gender: r.gender, email: r.email, admissionNumber: r.admission_number, status: r.status,
      }),
    ]),
  );
}

function lagosToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function ageOn(dob: string, today: string): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

export async function computeCorrectionPreview(
  db: PrismaClient,
  schoolId: string,
  corrections: CorrectionRows,
  snapshots: Map<string, StudentSnapshot>,
  now: Date = new Date(),
): Promise<CorrectionPreview> {
  const today = lagosToday(now);
  // Emails proposed, checked against other students of this school.
  const proposedEmails = [...new Set(corrections.flatMap((c) => (typeof c.changes.email === "string" ? [c.changes.email] : [])))];
  const holders = proposedEmails.length
    ? await db.student.findMany({ where: { schoolId, email: { in: proposedEmails, mode: "insensitive" } }, select: { id: true, email: true } })
    : [];

  const rows: StudentCorrectionRowDto[] = [];
  const writes: CorrectionPreview["writes"] = [];
  let fieldChanges = 0;
  let clears = 0;
  corrections.forEach((c, index) => {
    const s = snapshots.get(c.studentId);
    const errors: CorrectionProblem<CorrectionRowErrorCode>[] = [];
    const warnings: CorrectionProblem<CorrectionRowWarningCode>[] = [];
    const fields: StudentCorrectionFieldDto[] = [];
    if (!s) {
      errors.push({ code: "STUDENT_NOT_FOUND", message: "This student was not found." });
      rows.push({ index, studentId: c.studentId, current: null, fields, errors, warnings });
      return;
    }
    const data: Record<string, string | Date | null> = {};
    const changed: StudentCorrectionField[] = [];
    for (const field of STUDENT_CORRECTION_FIELDS) {
      if (!(field in c.changes)) continue; // absent: unchanged, not listed
      const after = (c.changes as StudentCorrectionChanges)[field] ?? null;
      const before = s[field];
      const change = after === before ? "SAME" : after === null ? "CLEAR" : "SET";
      fields.push({ field, before, after, change });
      if (change === "SAME") continue;
      changed.push(field);
      data[field] = field === "dateOfBirth" ? new Date(`${after}T00:00:00.000Z`) : after;
      fieldChanges += 1;
      if (change === "CLEAR") clears += 1;
    }
    if (typeof c.changes.dateOfBirth === "string" && c.changes.dateOfBirth !== s.dateOfBirth) {
      if (c.changes.dateOfBirth > today) errors.push({ code: "DATE_OF_BIRTH_IN_FUTURE", message: "The new date of birth is after today." });
      else {
        const age = ageOn(c.changes.dateOfBirth, today);
        if (age < 2 || age > 25) warnings.push({ code: "DATE_OF_BIRTH_UNUSUAL", message: `The new date of birth makes this student ${age} today.` });
      }
    }
    if (typeof c.changes.email === "string" && holders.some((h) => h.id !== s.id && h.email?.toLowerCase() === c.changes.email)) {
      warnings.push({ code: "EMAIL_SHARED", message: "Another student of this school has this email." });
    }
    if (s.status !== "ACTIVE") warnings.push({ code: "STUDENT_NOT_ACTIVE", message: `This student is ${s.status.toLowerCase()}.` });
    if (changed.length === 0) warnings.push({ code: "NO_CHANGE", message: "Every value given already matches the record: nothing to change." });
    rows.push({
      index, studentId: c.studentId,
      current: { name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "), admissionNumber: s.admissionNumber, status: s.status },
      fields, errors, warnings,
    });
    if (changed.length > 0 && errors.length === 0) writes.push({ studentId: s.id, changed, data });
  });

  const withErrors = rows.filter((r) => r.errors.length > 0).length;
  const batchErrors: StudentCorrectionProposalDto["batchErrors"] =
    withErrors === 0 && writes.length === 0 ? [{ code: "NOTHING_TO_APPLY", message: "No record would change." }] : [];
  const summary = {
    counts: {
      rows: rows.length, withErrors, withWarnings: rows.filter((r) => r.warnings.length > 0).length,
      toUpdate: writes.length, fieldChanges, clears,
    },
    batchErrors,
  };
  // Covers every value shown (before and after) and every problem; status too.
  const previewHash = fingerprint({ v: 1, rows, snapshot: [...snapshots.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), summary });
  return { rows, summary, writes, previewHash, canConfirm: withErrors === 0 && batchErrors.length === 0 };
}
