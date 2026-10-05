import { z } from "zod";

// Online exams (CBT1) — scheduling a sitting (docs/modules/cbt.md D1–D3).

export const CBT_SITTING_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED"] as const;
export type CbtSittingStatus = (typeof CBT_SITTING_STATUSES)[number];

const isoMoment = z.string().datetime({ offset: true });

const sittingFields = {
  title: z.string().trim().min(1).max(200),
  classArmIds: z.array(z.string().uuid()).min(1).max(30),
  // Moments, sent as ISO with offset: the browser turns the school's local
  // date and time into one.
  startsAt: isoMoment,
  // The latest a student may BEGIN; each student then has durationMinutes.
  windowEndsAt: isoMoment,
  durationMinutes: z.number().int().min(5).max(600),
};

export const createCbtSittingSchema = z.object({ paperId: z.string().uuid(), ...sittingFields });
export type CreateCbtSittingInput = z.infer<typeof createCbtSittingSchema>;

export const updateCbtSittingSchema = z.object(sittingFields);
export type UpdateCbtSittingInput = z.infer<typeof updateCbtSittingSchema>;

export const listCbtSittingsQuerySchema = z.object({
  status: z.enum(CBT_SITTING_STATUSES).optional(),
});
export type ListCbtSittingsQuery = z.infer<typeof listCbtSittingsQuerySchema>;

export interface CbtSittingSummaryDto {
  id: string;
  title: string;
  status: CbtSittingStatus;
  paperId: string;
  paperTitle: string;
  subjectName: string;
  classLevelName: string;
  termName: string;
  armNames: string[];
  startsAt: string;
  windowEndsAt: string;
  durationMinutes: number;
  // Frozen at publish; before that, how many are enrolled in the arms now.
  candidateCount: number;
}

export interface CbtSittingDto extends CbtSittingSummaryDto {
  classLevelId: string;
  subjectId: string;
  classArmIds: string[];
  versionCount: number;
  // The deliverable part of the paper (D1, Q2): multiple-choice questions.
  objectiveQuestionCount: number;
  objectiveTotal: number;
  // Short-answer and theory questions stay on paper (Q2).
  onPaperQuestionCount: number;
  onPaperTotal: number;
  paperTotal: number;
  publishedAt: string | null;
  closedAt: string | null;
  packBuiltAt: string | null;
}

// GET /cbt/sittings/:id/invigilator-sheet — the codes, for cbt.manage only.
// Every read is audited.
export interface CbtInvigilatorSheetDto {
  sittingId: string;
  schoolName: string;
  schoolSlug: string;
  title: string;
  subjectName: string;
  classLevelName: string;
  armNames: string[];
  startsAt: string;
  windowEndsAt: string;
  durationMinutes: number;
  candidateCount: number;
  accessCode: string;
  // Formatted XXXX-XXXX-XXXX.
  unlockCode: string;
}

export interface CbtCandidateRowDto {
  studentId: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  armName: string;
  version: string;
}

// Papers a sitting may be made from: FINAL, with at least one deliverable
// question, in the caller's scope.
export interface CbtSchedulablePaperDto {
  id: string;
  title: string;
  subjectId: string;
  subjectName: string;
  classLevelId: string;
  classLevelName: string;
  termId: string;
  termName: string;
  durationMinutes: number;
  objectiveQuestionCount: number;
  objectiveTotal: number;
  onPaperQuestionCount: number;
  arms: { id: string; name: string }[];
}
