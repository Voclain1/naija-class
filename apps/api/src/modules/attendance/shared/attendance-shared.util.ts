// Shared attendance helpers — used by BOTH the daily attendance service
// (Phase 2 / Slice 7) and the subject-period attendance service (Slice 8). The
// roster source (Enrollment), the term-by-date resolution, the date parsing, and
// the rate math are identical across the two surfaces; extracting them keeps the
// single source of truth so a fix (e.g. the enrolledAt roster filter) lands in
// one place. Slice 7's 14 integration tests guard this extraction.

import { withTenant } from "@school-kit/db";
import { ValidationError } from "@school-kit/types";

// The tenant-scoped Prisma handle (the `db` passed into withTenant's callback).
export type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

const MS_PER_DAY = 86_400_000;

// The narrow student select both registers + summaries read (id + name parts +
// admission number). Never widens to PII the attendance surfaces don't show.
export const STUDENT_NAME_SELECT = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  admissionNumber: true,
} as const;

export interface RosterStudent {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  admissionNumber: string;
}

export function fullName(s: { firstName: string; middleName: string | null; lastName: string }): string {
  return [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
}

// (attended / total) as Int hundredths (8000 = 80.00%). 0 when no records.
export function rateHundredths(attended: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((attended * 10_000) / total);
}

// YYYY-MM-DD (already regex-validated by the DTO) → UTC midnight, matching how
// Prisma reads a @db.Date column back. Keeps day comparisons timezone-free.
export function parseIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

// Roster for a register: students ENROLLED in (arm, term) who had joined by
// `date`. enrolledAt is a timestamp; `< nextMidnight` includes same-day joins
// and excludes anyone enrolled after the date (mid-term-join exclusion). Current
// arm only — a transferred student drops from the register but their existing
// records survive in the summary (queried by termId, not current enrollment).
export async function loadRoster(
  db: TenantDb,
  classArmId: string,
  termId: string,
  dateObj: Date,
): Promise<RosterStudent[]> {
  const nextDay = new Date(dateObj.getTime() + MS_PER_DAY);
  const enrollments = await db.enrollment.findMany({
    where: { classArmId, termId, status: "ENROLLED", enrolledAt: { lt: nextDay } },
    select: { studentId: true },
  });
  const studentIds = enrollments.map((e) => e.studentId);
  return db.student.findMany({
    where: { id: { in: studentIds } },
    select: STUDENT_NAME_SELECT,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// A date may only be marked/read if it falls inside an academic term and is not
// in the future. Both throw 400 (ValidationError). Returns the term id only.
export async function resolveTermForDate(db: TenantDb, dateObj: Date): Promise<{ id: string }> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (dateObj.getTime() > today.getTime()) {
    throw new ValidationError("Cannot record attendance for a future date.");
  }
  const term = await db.term.findFirst({
    where: { startDate: { lte: dateObj }, endDate: { gte: dateObj } },
    select: { id: true },
  });
  if (!term) throw new ValidationError("Date is not within any academic term.");
  return term;
}
