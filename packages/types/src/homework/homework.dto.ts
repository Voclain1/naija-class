import { z } from "zod";

// Homework (docs/modules/the-school-day.md Part B) — what to do, and by when.
//
// B7: INFORMATION, not workflow. There is no submission shape here and no
// `submittedAt` anywhere, deliberately. Submissions need per-student file
// storage, a marking queue, late and resubmit states, and an offline story for
// a child on one bar of signal — each a real design, and none of them what a
// parent asking "what is your homework?" needs tonight.
//
// If submissions are ever built they get their own plan-first and their own
// types. Do not grow this file into them.

export const HOMEWORK_TITLE_MAX = 120;
export const HOMEWORK_INSTRUCTIONS_MAX = 2000;

/** How far ahead a family's list looks. A term's worth is not a reading list. */
export const HOMEWORK_WINDOW_DAYS = 21;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-30.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist.");

/**
 * Posting homework.
 *
 * `dueDate` is a calendar date, never a timestamp — "due Friday" has no time
 * of day, and the DATE convention exists to keep "midnight in which zone?"
 * out of it.
 *
 * There is no `postedAt` input: a teacher cannot post into the past or the
 * future, because the point of the record is when the class was actually told.
 */
export const createHomeworkSchema = z
  .object({
    classArmId: z.string().uuid(),
    subjectId: z.string().uuid(),
    title: z.string().trim().min(1, "Give the homework a title.").max(HOMEWORK_TITLE_MAX),
    instructions: z.string().trim().max(HOMEWORK_INSTRUCTIONS_MAX).optional(),
    dueDate: isoDate,
  })
  .strict();
export type CreateHomeworkInput = z.infer<typeof createHomeworkSchema>;

/** The staff list. Defaults to the caller's own, which is what a teacher wants. */
export const homeworkListQuerySchema = z
  .object({
    classArmId: z.string().uuid().optional(),
    /**
     * Owner/admin only: everything the school set, not just their own.
     * A teacher passing it is refused rather than silently narrowed — a
     * request that cannot be honoured should say so.
     */
    all: z.coerce.boolean().optional(),
  })
  .strict();
export type HomeworkListQuery = z.infer<typeof homeworkListQuerySchema>;

export interface HomeworkDto {
  id: string;
  classArmId: string;
  /** Resolved so a list reads without a second request. */
  className: string;
  subjectId: string;
  subjectName: string;
  title: string;
  instructions: string | null;
  dueDate: string;
  postedAt: string | Date;
  /** Who set it. Staff see this; a family sees the subject teacher's name too. */
  postedByName: string | null;
  withdrawnAt: string | Date | null;
}

export interface HomeworkListResponse {
  data: HomeworkDto[];
}

/**
 * What a family sees: the same row, minus nothing — homework is not sensitive,
 * it is the work. `overdue` is computed by the SERVER against the school's
 * today, because a phone's clock is not the school's day.
 */
export interface HomeworkFeedItemDto extends HomeworkDto {
  overdue: boolean;
}

export interface HomeworkFeedResponse {
  data: HomeworkFeedItemDto[];
  /** Due today or tomorrow — what the home screen's one line is built from. */
  dueSoonCount: number;
}

export const HOMEWORK_PERMISSIONS = ["homework.read", "homework.create"] as const;
