import { z } from "zod";

// Phase 8 / CP3 — Timetable builder (docs/modules/phase-8.md §17).
//
// Times of day are integer minutes since midnight, school wall-clock time (D27).
// Weekdays are ISO: 1 = Monday … 7 = Sunday (§17.4 rule 3).

export const BELL_SLOT_KINDS = ["LESSON", "BREAK", "ASSEMBLY", "OTHER"] as const;
export type BellSlotKind = (typeof BELL_SLOT_KINDS)[number];

export const ISO_WEEKDAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

/** 490 → "08:10". */
export function formatMinuteOfDay(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "08:10" → 490; null when not a valid HH:MM. */
export function parseMinuteOfDay(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ---------------------------------------------------------------------------
// Bell schedule (one per school — D26) + school week (D34)
// ---------------------------------------------------------------------------

const minute = z.number().int().min(0).max(1440);

export const bellSlotInputSchema = z
  .object({
    /** Existing slot id when editing; omitted for a new slot. */
    id: z.string().uuid().optional(),
    label: z.string().trim().min(1, "Every period needs a name.").max(60),
    kind: z.enum(BELL_SLOT_KINDS),
    startMinute: minute,
    endMinute: minute,
  })
  .refine((s) => s.startMinute < s.endMinute, { message: "A period must end after it starts.", path: ["endMinute"] });
export type BellSlotInput = z.infer<typeof bellSlotInputSchema>;

/**
 * The whole schedule is saved at once, in order (position = index + 1). Slots
 * must not overlap — checked here AND in the service, because a partial save
 * of an overlapping schedule would make "same slot" stop meaning "same time".
 */
export const saveBellScheduleSchema = z
  .object({
    slots: z.array(bellSlotInputSchema).max(24),
    schoolWeekDays: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Pick at least one school day.")
      .max(7)
      .refine((d) => new Set(d).size === d.length, { message: "Days must not repeat." }),
  })
  .refine(
    (v) => v.slots.every((s, i) => i === 0 || (v.slots[i - 1]?.endMinute ?? 0) <= s.startMinute),
    { message: "Periods must be in time order and must not overlap.", path: ["slots"] },
  );
export type SaveBellScheduleInput = z.infer<typeof saveBellScheduleSchema>;

export interface BellSlotDto {
  id: string;
  position: number;
  label: string;
  kind: BellSlotKind;
  startMinute: number;
  endMinute: number;
  /** Lessons currently timetabled in this slot — a used slot can't be deleted or stop being a LESSON. */
  lessonCount: number;
}

export interface BellScheduleDto {
  slots: BellSlotDto[];
  schoolWeekDays: number[];
}

// ---------------------------------------------------------------------------
// Timetables
// ---------------------------------------------------------------------------

export const timetableQuerySchema = z.object({
  classArmId: z.string().uuid(),
  termId: z.string().uuid(),
});
export type TimetableQuery = z.infer<typeof timetableQuerySchema>;

export const createTimetableSchema = z.object({
  classArmId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  /** null = in force for the whole academic year (D3). */
  termId: z.string().uuid().nullable(),
});
export type CreateTimetableInput = z.infer<typeof createTimetableSchema>;

export const saveLessonSchema = z.object({
  timetableId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(7),
  bellSlotId: z.string().uuid(),
  subjectId: z.string().uuid(),
  /** Q34: may be empty — a school can timetable a subject before hiring. */
  teacherIds: z.array(z.string().uuid()).max(4),
  /** D24: a double period is consecutive LESSON slots — span 2 writes two lessons. */
  span: z.number().int().min(1).max(4).default(1),
});
export type SaveLessonInput = z.infer<typeof saveLessonSchema>;

export const clearLessonSchema = z.object({
  timetableId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(7),
  bellSlotId: z.string().uuid(),
});
export type ClearLessonInput = z.infer<typeof clearLessonSchema>;

export interface LessonTeacherDto {
  id: string;
  name: string;
}

export interface LessonDto {
  id: string;
  dayOfWeek: number;
  bellSlotId: string;
  subjectId: string;
  subjectName: string;
  teachers: LessonTeacherDto[];
}

export interface TimetableHeaderDto {
  id: string;
  classArmId: string;
  academicYearId: string;
  termId: string | null;
}

/**
 * What the builder shows for one class in one term: the timetable IN FORCE
 * (a term timetable if one exists, else the year-wide one — D13), plus whether
 * each kind exists, so the page can offer "Whole year" / "This term only".
 */
export interface TimetableViewDto {
  classArmId: string;
  termId: string;
  academicYearId: string;
  inForce: TimetableHeaderDto | null;
  yearWide: TimetableHeaderDto | null;
  termOnly: TimetableHeaderDto | null;
  lessons: LessonDto[]; // of inForce
  slots: BellSlotDto[];
  schoolWeekDays: number[];
}

/** One clash (D30), named precisely enough to act on. */
export interface TimetableClashDto {
  teacherId: string;
  teacherName: string;
  dayOfWeek: number;
  bellSlotId: string;
  slotLabel: string;
  termId: string;
  termName: string;
  classArms: Array<{ id: string; name: string }>;
}

/** D33 / Q36: saved, but the teacher's assignment does not cover every term this timetable is in force. */
export interface AssignmentWarningDto {
  teacherId: string;
  teacherName: string;
  uncoveredTermNames: string[];
}

export interface SaveLessonResultDto {
  lessons: LessonDto[];
  warnings: AssignmentWarningDto[];
}

export const TIMETABLE_ERROR_CODES = {
  CLASH: "TIMETABLE_CLASH",
  TEACHER_NOT_ASSIGNED: "TEACHER_NOT_ASSIGNED",
  NOT_A_LESSON_SLOT: "NOT_A_LESSON_SLOT",
  SPAN_OUT_OF_RANGE: "SPAN_OUT_OF_RANGE",
  CELL_OCCUPIED: "CELL_OCCUPIED",
  NOT_A_SCHOOL_DAY: "NOT_A_SCHOOL_DAY",
  SLOT_IN_USE: "SLOT_IN_USE",
  TIMETABLE_EXISTS: "TIMETABLE_EXISTS",
  TERM_NOT_IN_YEAR: "TERM_NOT_IN_YEAR",
} as const;
