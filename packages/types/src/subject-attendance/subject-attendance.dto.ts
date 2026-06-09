import { z } from "zod";

import { ATTENDANCE_STATUSES, type AttendanceStatusDto } from "../attendance/attendance.dto.js";

// Subject-period attendance DTOs (Phase 2 / Slice 8 — opt-in). Mirrors the daily
// attendance shapes with two extra coordinates: `subjectId` and `period`. Reuses
// the daily AttendanceStatus enum (no new status set). Date is the calendar day
// on the wire (YYYY-MM-DD); period is a 1-based integer with no upper bound.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");
const period = z.number().int().min(1, "Period must be 1 or greater.");

// GET /subject-attendance/register?classArmId=&subjectId=&date=&period=
export const subjectAttendanceRegisterQuerySchema = z
  .object({
    classArmId: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    date: isoDate,
    // Query params arrive as strings; coerce then validate as a 1-based int.
    period: z.coerce.number().int().min(1, "Period must be 1 or greater."),
  })
  .strict();
export type SubjectAttendanceRegisterQuery = z.infer<typeof subjectAttendanceRegisterQuerySchema>;

// POST /subject-attendance/mark — upsert one (subject, date, period) register.
export const subjectAttendanceMarkSchema = z
  .object({
    classArmId: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    date: isoDate,
    period,
    records: z
      .array(
        z
          .object({
            studentId: z.string().trim().min(1),
            status: z.enum(ATTENDANCE_STATUSES),
            note: z.string().trim().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type SubjectAttendanceMarkInput = z.infer<typeof subjectAttendanceMarkSchema>;

// GET /subject-attendance/summary?classArmId=&subjectId=&termId=
// (classArmId included despite the spec's abbreviated ?subjectId=&termId= — the
// per-arm summary mirrors slice 7's shape and is the consumable view.)
export const subjectAttendanceSummaryQuerySchema = z
  .object({
    classArmId: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    termId: z.string().trim().min(1),
  })
  .strict();
export type SubjectAttendanceSummaryQuery = z.infer<typeof subjectAttendanceSummaryQuerySchema>;

// One register row: an enrolled student + their mark for this (subject, date,
// period), null if unmarked.
export interface SubjectAttendanceRegisterRowDto {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  status: AttendanceStatusDto | null;
  note: string | null;
  markedBy: string | null;
  markedAt: string | Date | null;
}

export interface SubjectAttendanceRegisterResponse {
  date: string; // YYYY-MM-DD
  classArmId: string;
  subjectId: string;
  period: number;
  termId: string;
  records: SubjectAttendanceRegisterRowDto[];
}

export interface SubjectAttendanceMarkResultDto {
  count: number;
}

// One summary row: a student's per-status counts + attendance rate over the term
// for this subject. Aggregated by PERIOD record (each period attended counts).
export interface SubjectAttendanceSummaryRowDto {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  periodsMarked: number; // total period-records for this student/subject/term
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  // (PRESENT + LATE) / periodsMarked, Int hundredths. EXCUSED counts in the
  // denominator as not-attended (policy i, same as slice 7).
  attendanceRate: number;
}

export interface SubjectAttendanceArmSummaryDto {
  totalDaysOperated: number; // distinct dates this subject ran for the arm
  totalPeriodsOperated: number; // distinct (date, period) combinations
  subjectAttendanceRate: number; // mean of per-student rates, Int hundredths
}

export interface SubjectAttendanceSummaryResponse {
  classArmId: string;
  subjectId: string;
  termId: string;
  summary: SubjectAttendanceSummaryRowDto[];
  armSummary: SubjectAttendanceArmSummaryDto;
}
