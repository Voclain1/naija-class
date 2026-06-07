import { z } from "zod";

// Daily attendance DTOs (Phase 2 / Slice 7). Date is the calendar day, carried
// as a YYYY-MM-DD string on the wire (the column is @db.Date — no time-of-day);
// the service parses it to a Date for the term lookup + storage.

export type AttendanceStatusDto = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");

// GET /attendance/register?classArmId=&date= — the day's register for one arm.
export const attendanceRegisterQuerySchema = z
  .object({
    classArmId: z.string().trim().min(1),
    date: isoDate,
  })
  .strict();
export type AttendanceRegisterQuery = z.infer<typeof attendanceRegisterQuerySchema>;

// POST /attendance/mark — upsert the day's register. Atomic all-or-nothing.
export const attendanceMarkSchema = z
  .object({
    classArmId: z.string().trim().min(1),
    date: isoDate,
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
export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;

// GET /attendance/summary?classArmId=&termId= — per-student term stats.
export const attendanceSummaryQuerySchema = z
  .object({
    classArmId: z.string().trim().min(1),
    termId: z.string().trim().min(1),
  })
  .strict();
export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;

// One register row: an enrolled student + their mark for the date (null if
// unmarked).
export interface AttendanceRegisterRowDto {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  status: AttendanceStatusDto | null;
  note: string | null;
  markedBy: string | null;
  markedAt: string | Date | null;
}

export interface AttendanceRegisterResponse {
  date: string; // YYYY-MM-DD
  classArmId: string;
  termId: string;
  records: AttendanceRegisterRowDto[];
}

export interface AttendanceMarkResultDto {
  count: number;
}

// One summary row: a student's per-status counts + attendance rate over the term.
export interface AttendanceSummaryRowDto {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  daysMarked: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  // (PRESENT + LATE) / daysMarked, as Int hundredths (8000 = 80.00%). EXCUSED
  // counts in the denominator as not-attended; alternate metrics derive from
  // the per-status counts above.
  attendanceRate: number;
}

export interface AttendanceArmSummaryDto {
  totalDaysOperated: number; // distinct dates with any record in (arm, term)
  armAttendanceRate: number; // mean of per-student rates, Int hundredths
}

export interface AttendanceSummaryResponse {
  classArmId: string;
  termId: string;
  summary: AttendanceSummaryRowDto[];
  armSummary: AttendanceArmSummaryDto;
}
