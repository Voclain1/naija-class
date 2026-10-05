import { z } from "zod";

// Online exams (CBT3) — marking and results (docs/modules/cbt.md D5, D6, D8).
//
// The objective score is computed on the server, against the frozen paper's
// key, every time results are read. The teacher adds the theory mark from the
// paper scripts and, for a student who used more than one computer, chooses
// which attempt counts. Scores reach the gradebook only through the CP5a
// preview-then-save path, by a teacher.

/**
 * Things a teacher should look at before trusting an attempt (D6: flag,
 * don't reject):
 *   LATE_START     began after the latest start time
 *   OVER_TIME      ran longer than the exam (plus any extra time and a short grace)
 *   NOT_SUBMITTED  never finished — the answers are what arrived last
 *   AFTER_CLOSE    answers arrived after the exam was closed
 *   LEFT_WINDOW    the student left the exam window (see focusLosses)
 */
export const CBT_ATTEMPT_FLAGS = ["LATE_START", "OVER_TIME", "NOT_SUBMITTED", "AFTER_CLOSE", "LEFT_WINDOW"] as const;
export type CbtAttemptFlag = (typeof CBT_ATTEMPT_FLAGS)[number];

export interface CbtAttemptResultDto {
  id: string;
  /** "Computer 1", "Computer 2" — in the order their first answers arrived. */
  computerLabel: string;
  answeredCount: number;
  objectiveScore: number;
  startedAt: string;
  submittedAt: string | null;
  lastReceivedAt: string;
  /** Wall-clock minutes from start to finish (or to the last answers received). */
  minutesTaken: number;
  extraMinutes: number;
  focusLosses: number;
  flags: CbtAttemptFlag[];
  chosen: boolean;
}

export interface CbtResultRowDto {
  studentId: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  armName: string;
  version: string;
  attempts: CbtAttemptResultDto[];
  /** The attempt that counts: the chosen one, or the only one. */
  countingAttemptId: string | null;
  /** More than one attempt and none chosen yet. */
  needsChoice: boolean;
  objectiveScore: number | null;
  theoryMark: number | null;
  /** objective + theory, out of the paper's total. Null until it can be sent. */
  total: number | null;
}

export interface CbtResultsDto {
  sittingId: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  closedAt: string | null;
  questionCount: number;
  objectiveTotal: number;
  onPaperTotal: number;
  paperTotal: number;
  // Where "Send to gradebook" writes (CP5a): the paper's term and subject,
  // and the column the paper names, if any.
  termId: string;
  subjectId: string;
  componentId: string | null;
  rows: CbtResultRowDto[];
}

/** PUT /cbt/sittings/:id/theory-marks */
export const saveCbtTheoryMarksSchema = z
  .object({
    marks: z
      .array(
        z
          .object({
            studentId: z.string().trim().min(1),
            theoryMark: z.number().int().min(0).max(1000).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();
export type SaveCbtTheoryMarksInput = z.infer<typeof saveCbtTheoryMarksSchema>;
