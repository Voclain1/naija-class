import { z } from "zod";

// Phase 8 / CP2 — Recording Completeness (docs/modules/phase-8.md §16).
//
// Every number here answers "was the thing that produces a record DONE?",
// never "what did the record say?". There is deliberately no mark, grade,
// average or position anywhere in these shapes (§16.1, §16.4).
//
// Counts always travel with their denominator. A bare percentage invites the
// wrong reading ("20%" of registers taken reads as "20% attendance"), so the
// API does not compute one — the page states "12 of 61 school days".

export const completenessQuerySchema = z.object({
  // Optional: omitted → the school's current term.
  termId: z.string().uuid().optional(),
});
export type CompletenessQuery = z.infer<typeof completenessQuerySchema>;

export const TERM_HEALTH_SIGNALS = [
  "NO_CURRENT_TERM",
  "CURRENT_TERM_ENDED",
  "NEXT_TERM_NOT_CURRENT",
  "NO_ENROLLMENT_THIS_TERM",
  "ENROLLMENT_NOT_ROLLED_OVER",
  "ARMS_WITHOUT_FORM_TEACHER",
  "ARMS_WITHOUT_SUBJECT_TEACHERS",
] as const;
export type TermHealthSignalCode = (typeof TERM_HEALTH_SIGNALS)[number];

export interface TermHealthSignalDto {
  code: TermHealthSignalCode;
  /** One plain sentence saying what is wrong. */
  message: string;
  /** The existing screen that fixes it (D32). */
  href: string;
  /** Class arm names, for the two per-arm signals; empty otherwise. */
  arms: string[];
}

export interface CompletenessTermDto {
  id: string;
  name: string;
  academicYearLabel: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isCurrent: boolean;
}

/** A day removed from "expected" register days, and why (§16 D34 / Q31). */
export interface ExcludedDayDto {
  date: string; // YYYY-MM-DD
  reason: string; // e.g. "Independence Day (public holiday)"
}

export interface SchoolDaysDto {
  /** Lagos calendar day the report was computed for (D32). */
  asOf: string;
  /** First and last day counted; null when the term has not started yet. */
  countedFrom: string | null;
  countedTo: string | null;
  /** Monday–Friday in [countedFrom, countedTo], minus excludedDays. */
  schoolDayCount: number;
  /** Weekdays removed because they were holidays/breaks, listed so the number can be checked. */
  excludedDays: ExcludedDayDto[];
}

/** Groups shape (CLAUDE.md): keyed on ClassArm.id today, re-keyable later. */
export interface AttendanceArmRowDto {
  groupId: string;
  label: string;
  classLevelName: string;
  enrolledCount: number;
  registersExpected: number;
  registersTaken: number;
  /** Registers marked on a weekend or excluded day — shown, never counted toward "taken". */
  registersOnNonSchoolDays: number;
  lastRegisterDate: string | null;
}

export interface ScoreEntryRowDto {
  groupId: string; // ClassArm.id
  label: string; // arm name
  classLevelName: string;
  subjectId: string;
  subjectName: string;
  enrolledCount: number;
  componentCount: number;
  /** enrolledCount × componentCount. */
  slotsExpected: number;
  slotsEntered: number;
  /** Students with any score in this subject (materialised Assessment rows). */
  studentsWithScores: number;
  studentsSignedOff: number;
}

export interface UnassignedScoresRowDto {
  groupId: string;
  label: string;
  subjectId: string;
  subjectName: string;
  slotsEntered: number;
}

export const REPORT_CARD_STATUS_KEYS = [
  "DRAFT",
  "SUBJECT_REVIEWED",
  "FORM_REVIEWED",
  "PRINCIPAL_APPROVED",
  "RELEASED",
] as const;

export interface ReportCardPipelineRowDto {
  groupId: string;
  label: string;
  classLevelName: string;
  enrolledCount: number;
  byStatus: Record<(typeof REPORT_CARD_STATUS_KEYS)[number], number>;
  /** Enrolled students with no report card built for this term. */
  studentsWithoutCard: number;
}

export interface CompletenessReportDto {
  /** null only when no termId was given and the school has no current term. */
  term: CompletenessTermDto | null;
  health: TermHealthSignalDto[];
  schoolDays: SchoolDaysDto | null;
  attendance: {
    rows: AttendanceArmRowDto[];
    totals: { registersExpected: number; registersTaken: number; registersOnNonSchoolDays: number };
  } | null;
  scores: {
    rows: ScoreEntryRowDto[];
    unassigned: UnassignedScoresRowDto[];
    totals: { slotsExpected: number; slotsEntered: number };
  } | null;
  reportCards: {
    rows: ReportCardPipelineRowDto[];
    /** "awaiting principal approval THIS term" — distinct from the dashboard's all-terms count (§16.2). */
    totals: { byStatus: Record<(typeof REPORT_CARD_STATUS_KEYS)[number], number>; studentsWithoutCard: number };
  } | null;
}

/** One row per user holding the teacher role (§16 D37). Recording activity only. */
export interface TeacherActivityRowDto {
  userId: string;
  name: string;
  formArms: string[];
  /** Registers taken/expected for the arms this person is form teacher of — attributed to the ARM. */
  formArmRegistersExpected: number;
  formArmRegistersTaken: number;
  /** Distinct arm-days this person personally marked, in any arm. */
  registersMarkedByThisPerson: number;
  assignmentCount: number;
  /** Score slots owed on this person's assignments, and entered on them by anyone. */
  assignedSlotsExpected: number;
  assignedSlotsEntered: number;
  /** Of assignedSlotsEntered, how many this person entered themselves (the rest were keyed by someone else). */
  assignedSlotsEnteredByThisPerson: number;
  lastRegisterMarkedAt: string | null;
  lastScoreEnteredAt: string | null;
}

export interface TeacherActivityReportDto {
  term: CompletenessTermDto | null;
  schoolDays: SchoolDaysDto | null;
  rows: TeacherActivityRowDto[];
}

export const TERM_HEALTH_HREFS: Record<TermHealthSignalCode, string> = {
  NO_CURRENT_TERM: "/settings/academic",
  CURRENT_TERM_ENDED: "/settings/academic",
  NEXT_TERM_NOT_CURRENT: "/settings/academic",
  NO_ENROLLMENT_THIS_TERM: "/enrollments",
  ENROLLMENT_NOT_ROLLED_OVER: "/enrollments",
  ARMS_WITHOUT_FORM_TEACHER: "/settings/academic",
  ARMS_WITHOUT_SUBJECT_TEACHERS: "/staff",
};
