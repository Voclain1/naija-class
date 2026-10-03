import { z } from "zod";

import type { QuestionDto, QuestionType } from "../question-bank/question-bank.dto.js";
import { QUESTION_TYPES, QUESTION_TOPIC_MAX } from "../question-bank/question-bank.dto.js";
import { VERSION_LETTERS, type PaperVersion } from "./version-shuffle.js";

// Phase 8c / CP5c — exam papers (docs/modules/phase-8.md §22.3).
//
// A paper is sections of APPROVED questions. DRAFT is edited freely; FINAL is
// frozen (in the database too) and is the only state that can be exported.
// Total marks are computed from the questions, never typed.

export const EXAM_PAPER_TITLE_MAX = 200;
export const EXAM_PAPER_INSTRUCTIONS_MAX = 2000;
export const EXAM_PAPER_SECTIONS_MAX = 10;
export const EXAM_PAPER_QUESTIONS_MAX = 200;
export const EXAM_PAPER_DRAW_MAX = 50;

export type ExamPaperStatus = "DRAFT" | "FINAL";

const sectionSchema = z
  .object({
    title: z.string().trim().min(1, "Give the section a title.").max(EXAM_PAPER_TITLE_MAX),
    instructions: z.string().trim().max(EXAM_PAPER_INSTRUCTIONS_MAX).nullish(),
    questionIds: z.array(z.string().uuid()).max(EXAM_PAPER_QUESTIONS_MAX),
  })
  .strict();

const headerShape = {
  title: z.string().trim().min(1, "Give the paper a title.").max(EXAM_PAPER_TITLE_MAX),
  durationMinutes: z.number().int().min(5, "At least 5 minutes.").max(600, "At most 10 hours."),
  instructions: z.string().trim().max(EXAM_PAPER_INSTRUCTIONS_MAX).nullish(),
  /** The gradebook column this paper's marks go into, usually Exam. */
  componentId: z.string().uuid().nullish(),
  versionCount: z.number().int().min(1).max(VERSION_LETTERS.length).default(1),
};

export const createExamPaperSchema = z
  .object({
    subjectId: z.string().uuid(),
    classLevelId: z.string().uuid(),
    termId: z.string().uuid(),
    ...headerShape,
  })
  .strict();
export type CreateExamPaperInput = z.infer<typeof createExamPaperSchema>;

/**
 * Saving a draft: the header and the WHOLE section structure, replacing what
 * was there. A paper is small, and one write of the whole thing is simpler to
 * reason about than a dozen move/insert/remove endpoints.
 */
export const saveExamPaperSchema = z
  .object({
    ...headerShape,
    sections: z.array(sectionSchema).min(1, "A paper needs at least one section.").max(EXAM_PAPER_SECTIONS_MAX),
  })
  .strict()
  .superRefine((value, ctx) => {
    const all = value.sections.flatMap((s) => s.questionIds);
    if (all.length > EXAM_PAPER_QUESTIONS_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sections"], message: `A paper can hold at most ${EXAM_PAPER_QUESTIONS_MAX} questions.` });
    }
    if (new Set(all).size !== all.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sections"], message: "A question can appear only once in a paper." });
    }
  });
export type SaveExamPaperInput = z.infer<typeof saveExamPaperSchema>;

export const listExamPapersQuerySchema = z
  .object({
    subjectId: z.string().uuid().optional(),
    classLevelId: z.string().uuid().optional(),
    termId: z.string().uuid().optional(),
  })
  .strict();
export type ListExamPapersQuery = z.infer<typeof listExamPapersQuerySchema>;

/** Pick approved questions at random from the bank, to add to a section. */
export const drawQuestionsSchema = z
  .object({
    subjectId: z.string().uuid(),
    classLevelId: z.string().uuid(),
    type: z.enum(QUESTION_TYPES),
    topic: z.string().trim().max(QUESTION_TOPIC_MAX).optional(),
    count: z.number().int().min(1).max(EXAM_PAPER_DRAW_MAX),
    excludeIds: z.array(z.string().uuid()).max(EXAM_PAPER_QUESTIONS_MAX).default([]),
  })
  .strict();
export type DrawQuestionsInput = z.infer<typeof drawQuestionsSchema>;

export const exportExamPaperQuerySchema = z
  .object({ version: z.enum(VERSION_LETTERS).default("A") })
  .strict();
export type ExportExamPaperQuery = z.infer<typeof exportExamPaperQuerySchema>;

export const examPaperOutOfQuerySchema = z
  .object({ termId: z.string().uuid(), classArmId: z.string().uuid(), subjectId: z.string().uuid() })
  .strict();
export type ExamPaperOutOfQuery = z.infer<typeof examPaperOutOfQuerySchema>;

export interface ExamPaperSummaryDto {
  id: string;
  subjectId: string;
  subjectName: string;
  classLevelId: string;
  classLevelName: string;
  termId: string;
  termName: string;
  componentId: string | null;
  componentLabel: string | null;
  title: string;
  durationMinutes: number;
  instructions: string | null;
  versionCount: number;
  status: ExamPaperStatus;
  totalMarks: number;
  questionCount: number;
  createdBy: string;
  createdByName: string | null;
  finalisedByName: string | null;
  finalisedAt: string | Date | null;
  duplicatedFromId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ExamPaperSectionDto {
  id: string;
  title: string;
  instructions: string | null;
  marks: number;
  questions: QuestionDto[];
}

export interface ExamPaperDto extends ExamPaperSummaryDto {
  sections: ExamPaperSectionDto[];
  /**
   * What stands between this draft and FINAL, in words: empty sections, no
   * questions, questions retired since they were added. Empty when it can be
   * finalised.
   */
  problems: string[];
}

/** One question as printed in one version: options in that version's order. */
export interface ExamPaperExportQuestion {
  number: number;
  type: QuestionType;
  text: string;
  marks: number;
  options: { letter: string; text: string }[];
  /** Multiple choice only: the correct option's letter IN THIS VERSION. */
  correctLetter: string | null;
  answerGuide: string | null;
}

export interface ExamPaperExportDto {
  version: PaperVersion;
  versionCount: number;
  schoolName: string;
  title: string;
  subjectName: string;
  classLevelName: string;
  termName: string;
  academicYearLabel: string;
  durationMinutes: number;
  instructions: string | null;
  totalMarks: number;
  sections: {
    title: string;
    instructions: string | null;
    marks: number;
    questions: ExamPaperExportQuestion[];
  }[];
}

/** FINAL papers that fill a gradebook column, for its "Out of" (CP5a). */
export interface ExamPaperOutOfDto {
  papers: { componentId: string; paperId: string; title: string; totalMarks: number }[];
}
