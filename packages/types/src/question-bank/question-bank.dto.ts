import { z } from "zod";

// Phase 8c / CP5b — the question bank (docs/modules/phase-8.md §22.2).
//
// A question is DRAFT → APPROVED → RETIRED. Drafts are edited in place;
// an approved question never is — editing it makes a new draft that
// supersedes it, so a paper keeps the wording it was set with. Every AI draft
// starts as a DRAFT and reaches a paper only after a person approves it.

export const QUESTION_TYPES = ["MULTIPLE_CHOICE", "SHORT_ANSWER", "THEORY"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];

export const QUESTION_STATUSES = ["DRAFT", "APPROVED", "RETIRED"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export type QuestionSource = "MANUAL" | "AI";

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  SHORT_ANSWER: "Short answer",
  THEORY: "Theory",
};

export const QUESTION_TOPIC_MAX = 200;
export const QUESTION_TEXT_MAX = 4000;
export const QUESTION_ANSWER_GUIDE_MAX = 4000;
export const QUESTION_OPTION_TEXT_MAX = 500;
export const QUESTION_MARKS_MAX = 100;
/** A–D is the WAEC/NECO shape; A–E is allowed, as some schools use it. */
export const QUESTION_OPTIONS_MIN = 2;
export const QUESTION_OPTIONS_MAX = 5;
/** Per AI request. Ten theory questions with marking guides is already a long answer. */
export const QUESTION_GENERATE_MAX = 10;

export interface QuestionOptionInput {
  text: string;
  isCorrect: boolean;
}

/**
 * The type rules, as one pure function both the API and the form use, so
 * the form says exactly what the server will refuse. Returns the first problem
 * found, in words a teacher can act on, or null.
 */
export function findQuestionContentError(input: {
  type: QuestionType;
  answerGuide?: string | null;
  options: readonly QuestionOptionInput[];
}): { path: "options" | "answerGuide"; message: string } | null {
  if (input.type === "MULTIPLE_CHOICE") {
    const filled = input.options.filter((o) => o.text.trim() !== "");
    if (filled.length < QUESTION_OPTIONS_MIN || filled.length !== input.options.length) {
      return {
        path: "options",
        message: `Give between ${QUESTION_OPTIONS_MIN} and ${QUESTION_OPTIONS_MAX} options, none left blank.`,
      };
    }
    const correct = input.options.filter((o) => o.isCorrect).length;
    if (correct !== 1) return { path: "options", message: "Mark exactly one option as the correct answer." };
    return null;
  }
  if (input.options.length > 0) {
    return { path: "options", message: "Only multiple-choice questions have options." };
  }
  if (!input.answerGuide || input.answerGuide.trim() === "") {
    return { path: "answerGuide", message: "Write the expected answer or marking guide." };
  }
  return null;
}

const optionSchema = z
  .object({
    text: z.string().trim().max(QUESTION_OPTION_TEXT_MAX),
    isCorrect: z.boolean(),
  })
  .strict();

const contentShape = {
  topic: z.string().trim().min(1, "Give the topic.").max(QUESTION_TOPIC_MAX),
  type: z.enum(QUESTION_TYPES),
  difficulty: z.enum(QUESTION_DIFFICULTIES).default("MEDIUM"),
  text: z.string().trim().min(1, "Write the question.").max(QUESTION_TEXT_MAX),
  marks: z.number().int().min(1, "At least 1 mark.").max(QUESTION_MARKS_MAX),
  answerGuide: z.string().trim().max(QUESTION_ANSWER_GUIDE_MAX).nullish(),
  options: z.array(optionSchema).max(QUESTION_OPTIONS_MAX).default([]),
};

function refineContent(value: { type: QuestionType; answerGuide?: string | null; options: QuestionOptionInput[] }, ctx: z.RefinementCtx) {
  const error = findQuestionContentError(value);
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [error.path], message: error.message });
}

export const createQuestionSchema = z
  .object({ subjectId: z.string().uuid(), classLevelId: z.string().uuid(), ...contentShape })
  .strict()
  .superRefine(refineContent);
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

/**
 * A full replacement of the content. Subject and level are fixed for a
 * question's life — moving one is writing a new one.
 */
export const updateQuestionSchema = z.object(contentShape).strict().superRefine(refineContent);
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export const listQuestionsQuerySchema = z
  .object({
    subjectId: z.string().uuid().optional(),
    classLevelId: z.string().uuid().optional(),
    type: z.enum(QUESTION_TYPES).optional(),
    status: z.enum(QUESTION_STATUSES).optional(),
    /** Matches topic or question text, case-insensitively. */
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;

export const generateQuestionsSchema = z
  .object({
    subjectId: z.string().uuid(),
    classLevelId: z.string().uuid(),
    topic: z.string().trim().min(1, "Give the topic.").max(QUESTION_TOPIC_MAX),
    type: z.enum(QUESTION_TYPES),
    difficulty: z.enum(QUESTION_DIFFICULTIES).default("MEDIUM"),
    count: z.number().int().min(1).max(QUESTION_GENERATE_MAX).default(5),
  })
  .strict();
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;

export interface QuestionOptionDto {
  id: string;
  orderIndex: number;
  text: string;
  isCorrect: boolean;
}

export interface QuestionDto {
  id: string;
  subjectId: string;
  subjectName: string;
  classLevelId: string;
  classLevelName: string;
  topic: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  text: string;
  marks: number;
  answerGuide: string | null;
  status: QuestionStatus;
  source: QuestionSource;
  createdBy: string;
  createdByName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | Date | null;
  retiredAt: string | Date | null;
  /** The approved question this draft revises, if it is a revision. */
  supersedesId: string | null;
  /** For an approved question: the id of its draft revision, if one is open. */
  openRevisionId: string | null;
  options: QuestionOptionDto[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** Why AI drafting had (or lacked) the school's own scheme of work to work from. */
export type QuestionGroundingReason =
  | "ok"
  | "no-documents"
  | "awaiting-review"
  | "no-match"
  | "not-configured"
  | "error";

export interface GenerateQuestionsResponse {
  questions: QuestionDto[];
  requested: number;
  /** Drafts the model returned that broke the type rules and were not saved. */
  dropped: number;
  grounding: {
    reason: QuestionGroundingReason;
    /** The model's own judgement that the supplied scheme of work covered the topic. */
    usedScheme: boolean | null;
  };
}

/**
 * What the caller may work on. Owner/admin (`all`): any active class level
 * with any active subject — the admin gradebook's rule, since many schools
 * never fill in the level-subject matrix. A teacher: exactly `pairs`, the
 * (class level, subject) combinations they teach; `levels` and `subjects` are
 * then just the distinct values in `pairs`.
 */
export interface QuestionScopeDto {
  all: boolean;
  levels: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  pairs: { classLevelId: string; classLevelName: string; subjectId: string; subjectName: string }[];
}
