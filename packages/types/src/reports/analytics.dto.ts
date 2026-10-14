import { z } from "zod";

import type { CompletenessTermDto } from "./completeness.dto.js";

// Phase 9 / CP1.2 — reports and analytics (docs/modules/phase-9.md §8.3).
//
// Owner/admin only (CP1-D6). Rules every shape below keeps:
//   * Results come from RELEASED report cards only (CP1-D4): a mark still in
//     review never reaches a chart.
//   * Averages and rates are integers in HUNDREDTHS (7350 = 73.50), like
//     ReportCard.overallAverage; they are formatted only at display.
//   * Anything broken down by class uses the "groups" shape (groupId = the
//     class arm today, the campus one day — CLAUDE.md).
//   * Nothing here is money (CP1-D9).

export const analyticsQuerySchema = z.object({
  // Optional: omitted → the school's current term.
  termId: z.string().uuid().optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/** How many top and bottom students each class lists. */
export const RANKING_SIZE = 5;
/** How many terms the teacher trend covers, the chosen one included. */
export const TEACHER_TREND_TERMS = 3;

// ---------------------------------------------------------------------------
// Academic
// ---------------------------------------------------------------------------

export interface ClassAverageRowDto {
  groupId: string;
  label: string;
  classLevelName: string;
  /** Students whose report card for the term is RELEASED; only they are counted. */
  releasedCount: number;
  averageHundredths: number | null;
  /** The same class's average in the previous term, when both exist. */
  previousAverageHundredths: number | null;
  changeHundredths: number | null;
}

export interface SubjectAverageCellDto {
  groupId: string;
  subjectId: string;
  averageHundredths: number;
  studentCount: number;
}

export interface RankedStudentDto {
  studentId: string;
  name: string;
  admissionNumber: string;
  averageHundredths: number;
}

export interface ClassRankingDto {
  groupId: string;
  label: string;
  top: RankedStudentDto[];
  /** Never repeats a student already in `top` (a class of 7 lists 5 and 2). */
  bottom: RankedStudentDto[];
}

export interface AcademicReportDto {
  term: CompletenessTermDto | null;
  previousTerm: CompletenessTermDto | null;
  classes: ClassAverageRowDto[];
  /** Subjects with at least one released result, A→Z. */
  subjects: Array<{ subjectId: string; subjectName: string }>;
  /** One cell per (class, subject) that has released results: the heatmap. */
  cells: SubjectAverageCellDto[];
  rankings: ClassRankingDto[];
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface AttendanceWeekCellDto {
  /** The Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  /** (present + late) ÷ marked, hundredths; null when nothing was marked that week. */
  rateHundredths: number | null;
  recordsMarked: number;
}

export interface ClassAttendanceTrendDto {
  groupId: string;
  label: string;
  classLevelName: string;
  weeks: AttendanceWeekCellDto[];
  termRateHundredths: number | null;
}

export interface ChronicAbsenceRowDto {
  studentId: string;
  name: string;
  admissionNumber: string;
  classLabel: string;
  daysMarked: number;
  daysAbsent: number;
  rateHundredths: number;
}

export interface MissingRegisterRowDto {
  groupId: string;
  label: string;
  /** School days with no register for this class, oldest first. */
  dates: string[];
}

export interface AttendanceReportDto {
  term: CompletenessTermDto | null;
  /** The school's chronic-absence line, whole percent (Settings). */
  thresholdPercent: number;
  /** Monday of every week in the term so far, oldest first. */
  weeks: string[];
  classes: ClassAttendanceTrendDto[];
  /** Students below the threshold, lowest rate first. */
  chronicAbsence: ChronicAbsenceRowDto[];
  missingRegisters: MissingRegisterRowDto[];
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export interface EnrolmentLevelRowDto {
  groupId: string; // ClassLevel.id
  label: string;
  thisTerm: number;
  previousTerm: number | null;
}

export interface EnrolmentMoverDto {
  studentId: string;
  name: string;
  admissionNumber: string;
  classLabel: string;
  /** Plain words: "New this term", "Withdrawn", "Graduated", "Not enrolled this term"… */
  reason: string;
}

export interface EnrolmentReportDto {
  term: CompletenessTermDto | null;
  previousTerm: CompletenessTermDto | null;
  levels: EnrolmentLevelRowDto[];
  totals: { thisTerm: number; previousTerm: number | null };
  /** In this term and not the previous one. Empty when there is no previous term. */
  joiners: EnrolmentMoverDto[];
  /** In the previous term and not this one. */
  leavers: EnrolmentMoverDto[];
}

// ---------------------------------------------------------------------------
// Teacher trend — recording only, never pupils' marks (CP1-D8)
// ---------------------------------------------------------------------------

export interface TeacherTrendCellDto {
  termId: string;
  formRegistersTaken: number;
  formRegistersExpected: number;
  scoresEntered: number;
  scoresExpected: number;
}

export interface TeacherTrendRowDto {
  userId: string;
  name: string;
  /** Same order as the report's `terms`; null for a term they had nothing assigned. */
  terms: Array<TeacherTrendCellDto | null>;
}

export interface TeacherTrendReportDto {
  /** Oldest first, ending with the chosen term. */
  terms: CompletenessTermDto[];
  rows: TeacherTrendRowDto[];
}

/** 7350 → "73.50". The only place hundredths become text. */
export function formatHundredths(value: number | null): string {
  if (value === null) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
