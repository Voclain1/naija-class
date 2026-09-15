import { z } from "zod";

import type { AssignmentWarningDto, BellSlotKind, LessonDto, TimetableClashDto, TimetableHeaderDto } from "./timetable.dto.js";

// Phase 8 / CP4 — timetable lifecycle, publishing and read surfaces
// (docs/modules/phase-8.md §18, D37–D45).

// ---------------------------------------------------------------------------
// Fork and copy (D41, D42)
// ---------------------------------------------------------------------------

export const forkTimetableSchema = z.object({
  /** The term the new term-only timetable is for. Must be in the source year. */
  termId: z.string().uuid(),
});
export type ForkTimetableInput = z.infer<typeof forkTimetableSchema>;

/** One teacher the admin agreed to leave off one copied lesson (Q42). */
export const teacherRemovalSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  bellSlotId: z.string().uuid(),
  teacherId: z.string().uuid(),
});
export type TeacherRemovalDto = z.infer<typeof teacherRemovalSchema>;

export const copyTimetableSchema = z.object({
  academicYearId: z.string().uuid(),
  /** null = the destination is the class's whole-year timetable. */
  termId: z.string().uuid().nullable(),
  /**
   * Q42 — copy lessons without the teachers who are not assigned for the
   * destination. Accepted ONLY with `acknowledgedRemovals` equal to exactly the
   * removals the server computes; otherwise the copy is refused.
   */
  leaveUnassignedTeachersOff: z.boolean().default(false),
  acknowledgedRemovals: z.array(teacherRemovalSchema).max(500).default([]),
});
export type CopyTimetableInput = z.infer<typeof copyTimetableSchema>;

export const copyPreviewQuerySchema = z.object({
  preview: z.enum(["true", "false"]).optional(),
});

/** A copied lesson whose teacher has no effective assignment at the destination. */
export interface UnassignedTeacherDto {
  dayOfWeek: number;
  bellSlotId: string;
  slotLabel: string;
  teacherId: string;
  teacherName: string;
  subjectName: string;
}

/** Every reason a fork or copy cannot be written — all of them, never only the first (§18.4 rule 2). */
export interface CopyProblemsDto {
  /** Lessons already in the destination timetable (0 = none). The copy never merges into them. */
  destinationLessonCount: number;
  unassignedTeachers: UnassignedTeacherDto[];
  /**
   * Clashes the copy would add. Only computed when the destination is empty —
   * lessons cannot be test-written into occupied cells — and stated as such.
   */
  clashes: TimetableClashDto[];
  clashesChecked: boolean;
  /** leaveUnassignedTeachersOff was sent, but the acknowledged list differs from the server's. */
  acknowledgementMismatch: boolean;
}

export interface CopyResultDto {
  preview: boolean;
  /** true when nothing prevents the copy (for a preview: "Copy" may be pressed). */
  ok: boolean;
  /** The destination timetable (null on a preview or a refusal that never created it). */
  timetable: TimetableHeaderDto | null;
  lessonsCopied: number;
  /** Teachers left off, when leaveUnassignedTeachersOff was used with a matching acknowledgement. */
  removedTeachers: UnassignedTeacherDto[];
  /** D33 partial coverage: saved, but these teachers are not assigned in every destination term. */
  assignmentWarnings: AssignmentWarningDto[];
  /**
   * The destination's lessons as written, READ BACK from the database before
   * commit (or before the preview's rollback). A preview and the real copy of the
   * same state return identical lessons (ids aside) because they are the same path.
   */
  lessons: LessonDto[];
  problems: CopyProblemsDto;
}

// ---------------------------------------------------------------------------
// Publishing (D45)
// ---------------------------------------------------------------------------

/** The frozen document families see. Self-contained: no ids a family could follow. */
export interface PublishedGridDto {
  slots: Array<{ position: number; label: string; kind: BellSlotKind; startMinute: number; endMinute: number }>;
  days: number[];
  lessons: Array<{ dayOfWeek: number; slotPosition: number; subjectName: string; teacherNames: string[] }>;
}

export const withdrawPublicationSchema = z.object({
  classArmId: z.string().uuid(),
  termId: z.string().uuid(),
});
export type WithdrawPublicationInput = z.infer<typeof withdrawPublicationSchema>;

export type PublicationState = "NOT_PUBLISHED" | "UP_TO_DATE" | "UNPUBLISHED_CHANGES";

export interface PublicationStatusDto {
  state: PublicationState;
  publishedAt: string | null;
}

export interface PublishResultDto {
  /** The terms a snapshot was written for (every term this timetable is in force). */
  terms: Array<{ id: string; name: string }>;
  publishedAt: string;
}

// ---------------------------------------------------------------------------
// Read surfaces (D37, D39)
// ---------------------------------------------------------------------------

export interface TeacherOwnLessonDto {
  dayOfWeek: number;
  slot: { position: number; label: string; startMinute: number; endMinute: number };
  classArmId: string;
  className: string;
  subjectName: string;
  /** Other teachers on the same lesson (co-teaching). */
  coTeacherNames: string[];
}

export interface TeacherFormClassDto {
  classArmId: string;
  className: string;
  lessons: LessonDto[];
}

export const teacherTimetableQuerySchema = z.object({
  termId: z.string().uuid().optional(),
});
export type TeacherTimetableQuery = z.infer<typeof teacherTimetableQuerySchema>;

export interface TeacherTimetableDto {
  /** null when the school has no current term and none was requested. */
  term: { id: string; name: string } | null;
  /** The terms of the selected term's year, for the picker. */
  terms: Array<{ id: string; name: string; isCurrent: boolean }>;
  slots: Array<{ id: string; position: number; label: string; kind: BellSlotKind; startMinute: number; endMinute: number }>;
  schoolWeekDays: number[];
  ownLessons: TeacherOwnLessonDto[];
  /** Read-only grids of the classes this teacher form-teaches (Q38). */
  formClasses: TeacherFormClassDto[];
}

export type FamilyTimetableState = "NO_CURRENT_TERM" | "NOT_ENROLLED" | "NOT_PUBLISHED" | "PUBLISHED";

export interface FamilyTimetableDto {
  state: FamilyTimetableState;
  className: string | null;
  termName: string | null;
  publishedAt: string | null;
  grid: PublishedGridDto | null;
}

export const LIFECYCLE_ERROR_CODES = {
  COPY_REFUSED: "TIMETABLE_COPY_REFUSED",
  NOT_YEAR_WIDE: "NOT_YEAR_WIDE",
  SAME_AS_SOURCE: "SAME_AS_SOURCE",
  NOTHING_TO_PUBLISH: "NOTHING_TO_PUBLISH",
  PUBLISH_BLOCKED_BY_CLASH: "PUBLISH_BLOCKED_BY_CLASH",
} as const;
