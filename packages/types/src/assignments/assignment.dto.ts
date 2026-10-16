import { z } from "zod";

// Phase 9 / CP4 — assignments: submitted work and marking
// (docs/modules/phase-9.md §11).
//
// "Collect work" is switched on for one homework item. Students hand in a
// typed answer (CP4.1), photos or PDFs (CP4.2), and answers to questions the
// server marks automatically (CP4.3).
//
// Who reads what (CP4-D2):
//   - owner, admin and the class's teachers: every submission, with the paste
//     counts (Q7) — `AssignmentSubmissionDto`;
//   - the student: their own attempts, and the mark and feedback only once
//     released — `MyAssignmentDto`, which has no field for the paste counts;
//   - the child's guardians: whether it was handed in, late, and the mark and
//     feedback once released — `FamilyAssignmentDto`, with no answer text and
//     no paste counts;
//   - the bursar: nothing.
// No AI anywhere in it (Q6: students get no AI writing help).

export const ASSIGNMENT_LIMITS = {
  totalMarks: 1000,
  body: 20_000,
  feedback: 2000,
  returnNote: 500,
  /** Photos or PDFs per attempt (Q8, CP4.2). */
  files: 3,
  /** CP4b: the staff-only marking guide sent to the AI drafter. */
  markingGuide: 4000,
  /** CP4.3: questions per assignment, and their parts. */
  questions: 50,
  questionText: 2000,
  questionMarks: 100,
  optionText: 500,
  optionsMin: 2,
  optionsMax: 5,
  acceptedAnswers: 10,
  answerText: 200,
} as const;

/** Switch "collect work" on for a homework item, or change its settings. */
export const collectWorkSchema = z
  .object({
    totalMarks: z.number().int().min(1, "Give the work a total mark.").max(ASSIGNMENT_LIMITS.totalMarks),
    accepting: z.boolean().optional(),
    /** CP4b: what a good answer includes. Staff only. Empty clears it; absent leaves it. */
    markingGuide: z
      .string()
      .trim()
      .max(ASSIGNMENT_LIMITS.markingGuide)
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "" ? null : v)),
  })
  .strict();
export type CollectWorkInput = z.infer<typeof collectWorkSchema>;

/**
 * A student hands in a typed answer, the files they attached (CP4.2), or both.
 * The two counts are what the student's own device saw arrive by typing and by
 * pasting (Q7); the server clamps them. The server refuses an attempt with
 * neither text nor files.
 */
export const submitWorkSchema = z
  .object({
    body: z
      .string()
      .trim()
      .max(ASSIGNMENT_LIMITS.body)
      .optional()
      .transform((v) => (v ? v : undefined)),
    typedChars: z.number().int().min(0).max(1_000_000).default(0),
    pastedChars: z.number().int().min(0).max(1_000_000).default(0),
    /**
     * CP4.3: answers to the questions, keyed by question id — the option's
     * index for multiple choice, the text for fill-in. Unanswered questions
     * are simply left out.
     */
    answers: z
      .record(
        z.string().uuid(),
        z.union([
          z.number().int().min(0).max(ASSIGNMENT_LIMITS.optionsMax - 1),
          z.string().max(ASSIGNMENT_LIMITS.answerText),
        ]),
      )
      .optional(),
  })
  .strict();
export type SubmitWorkInput = z.input<typeof submitWorkSchema>;

export const markSubmissionSchema = z
  .object({
    mark: z.number().int().min(0, "A mark can't be below 0."),
    feedback: z
      .string()
      .trim()
      .max(ASSIGNMENT_LIMITS.feedback)
      .optional()
      .transform((v) => (v ? v : undefined)),
    /** CP4b: the teacher started from an AI draft. Recorded, never shown to families. */
    fromAiDraft: z.boolean().optional(),
  })
  .strict();
export type MarkSubmissionInput = z.input<typeof markSubmissionSchema>;

export const returnSubmissionSchema = z
  .object({
    note: z.string().trim().min(1, "Tell the student what to change.").max(ASSIGNMENT_LIMITS.returnNote),
  })
  .strict();
export type ReturnSubmissionInput = z.infer<typeof returnSubmissionSchema>;

// ---------------------------------------------------------------------------
// CP4.3 — questions and automatic marking (CP4-D6).
// ---------------------------------------------------------------------------

export type AssignmentQuestionType = "MULTIPLE_CHOICE" | "FILL_IN";

const questionText = z
  .string()
  .trim()
  .min(1, "Write the question.")
  .max(ASSIGNMENT_LIMITS.questionText);
const questionMarks = z
  .number()
  .int()
  .min(1, "A question is worth at least 1 mark.")
  .max(ASSIGNMENT_LIMITS.questionMarks);

const multipleChoiceQuestionSchema = z
  .object({
    type: z.literal("MULTIPLE_CHOICE"),
    text: questionText,
    marks: questionMarks,
    options: z
      .array(z.string().trim().min(1, "Fill in every option, or remove it.").max(ASSIGNMENT_LIMITS.optionText))
      .min(ASSIGNMENT_LIMITS.optionsMin, "Give at least 2 options.")
      .max(ASSIGNMENT_LIMITS.optionsMax, "Give at most 5 options."),
    correctIndex: z.number().int().min(0),
    /** The question-bank question it was copied from, if any. */
    sourceQuestionId: z.string().uuid().optional(),
  })
  .strict()
  .refine((q) => q.correctIndex < q.options.length, { message: "Pick the right option.", path: ["correctIndex"] });

const fillInQuestionSchema = z
  .object({
    type: z.literal("FILL_IN"),
    text: questionText,
    marks: questionMarks,
    acceptedAnswers: z
      .array(z.string().trim().min(1).max(ASSIGNMENT_LIMITS.answerText))
      .min(1, "List at least one accepted answer.")
      .max(ASSIGNMENT_LIMITS.acceptedAnswers, "List at most 10 accepted answers."),
  })
  .strict();

export const assignmentQuestionInputSchema = z.union([multipleChoiceQuestionSchema, fillInQuestionSchema]);
export type AssignmentQuestionInput = z.infer<typeof assignmentQuestionInputSchema>;

/** Replace the whole list, in order. Only before anyone has handed in. */
export const setAssignmentQuestionsSchema = z
  .object({
    questions: z.array(assignmentQuestionInputSchema).max(ASSIGNMENT_LIMITS.questions, "At most 50 questions."),
  })
  .strict();
export type SetAssignmentQuestionsInput = z.infer<typeof setAssignmentQuestionsSchema>;

/** A question as staff see it: with the right answer. */
export interface AssignmentQuestionDto {
  id: string;
  number: number;
  type: AssignmentQuestionType;
  text: string;
  marks: number;
  /** Multiple choice only. */
  options: string[] | null;
  correctIndex: number | null;
  /** Fill-in only. */
  acceptedAnswers: string[] | null;
  /** Copied from the question bank. */
  fromBank: boolean;
}

/** A question as the student sees it: never the right answer. */
export interface MyAssignmentQuestionDto {
  id: string;
  number: number;
  type: AssignmentQuestionType;
  text: string;
  marks: number;
  options: string[] | null;
}

/**
 * One answer on an attempt. Staff always get `correct`; the student gets it
 * only once the marks are released, and never the right answer itself.
 */
export interface AnswerResultDto {
  questionId: string;
  number: number;
  /** The option's index, the text, or null when left blank. */
  answer: number | string | null;
  correct: boolean | null;
}

/** An approved multiple-choice question in the bank, for copying in. */
export interface BankQuestionDto {
  id: string;
  topic: string;
  text: string;
  marks: number;
  options: string[];
  correctIndex: number;
}

export interface BankQuestionListResponse {
  data: BankQuestionDto[];
}

/**
 * How a fill-in answer is compared: case ignored, spaces at either end
 * dropped, repeated spaces inside counted as one. Nothing fuzzier (CP4-D6).
 */
export function normaliseFillIn(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Whether one answer is right. A blank answer never is. */
export function isAnswerRight(
  question: Pick<AssignmentQuestionDto, "type" | "correctIndex" | "acceptedAnswers">,
  answer: number | string | null | undefined,
): boolean {
  if (answer === null || answer === undefined) return false;
  if (question.type === "MULTIPLE_CHOICE") return typeof answer === "number" && answer === question.correctIndex;
  if (typeof answer !== "string") return false;
  const given = normaliseFillIn(answer);
  if (given === "") return false;
  return (question.acceptedAnswers ?? []).some((a) => normaliseFillIn(a) === given);
}

/** The letter for an option: A, B, C… */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * Where one student stands, from their latest attempt:
 *   NOT_SUBMITTED — nothing handed in;
 *   SUBMITTED — handed in, waiting to be marked;
 *   RETURNED — sent back to be done again; the student may hand in again;
 *   MARKED — marked (the family sees the mark only once it is released).
 */
export type WorkStatus = "NOT_SUBMITTED" | "SUBMITTED" | "RETURNED" | "MARKED";

export interface AssignmentCollectionDto {
  assignmentId: string;
  totalMarks: number;
  accepting: boolean;
  /** CP4b: staff only. */
  markingGuide: string | null;
}

// ---------------------------------------------------------------------------
// CP4b — AI-drafted marking feedback, optional at every level (§12). A draft
// is never a mark: only the teacher's own "Save mark" writes one.
// ---------------------------------------------------------------------------

export type FeedbackDraftStatus = "PENDING" | "READY" | "FAILED";

/** An AI draft, for staff only. */
export interface FeedbackDraftDto {
  status: FeedbackDraftStatus;
  /** READY only. */
  mark: number | null;
  feedback: string | null;
  /** One line for the teacher on why that mark. Never shown to the student. */
  reason: string | null;
  /** FAILED only: why, in words a teacher can read. */
  failure: string | null;
  createdAt: string | Date;
}

/** The school's own switch, and what else decides whether drafting is offered. */
export interface AiMarkingSettingsDto {
  /** The school's own opt-in (owner or admin). Off by default. */
  enabled: boolean;
  /** The platform's per-school AI switch. */
  aiEnabled: boolean;
  /** Whether the school's plan includes it now. */
  planIncludes: boolean;
  /** Whether AI is set up on this system at all. */
  aiConfigured: boolean;
}

export const updateAiMarkingSettingsSchema = z.object({ enabled: z.boolean() }).strict();
export type UpdateAiMarkingSettingsInput = z.infer<typeof updateAiMarkingSettingsSchema>;

export interface DraftFeedbackResultDto {
  /** Typed answers queued for a draft. */
  queued: number;
}

/** A photo or PDF answer (CP4.2). Opened through a five-minute link. */
export interface SubmissionFileDto {
  id: string;
  type: "image" | "pdf";
  size: number;
}

/** A five-minute link to a private file (F1). */
export interface AssignmentFileUrlDto {
  url: string;
}

/** One attempt, as staff see it. */
export interface AssignmentSubmissionDto {
  id: string;
  studentId: string;
  attempt: number;
  /** Null when the attempt is files alone. */
  body: string | null;
  files: SubmissionFileDto[];
  submittedAt: string | Date;
  late: boolean;
  /** CP4b: the saved mark started from an AI draft. Staff only. */
  feedbackAiDrafted: boolean;
  /** CP4b: the AI draft for this attempt, if one was asked for. Staff only. */
  draft: FeedbackDraftDto | null;
  /** CP4.3: one per question, in order; empty when there are no questions. */
  answers: AnswerResultDto[];
  /** The mark worked out from the questions; null when there are none. */
  autoMark: number | null;
  /** Q7: about how much of the answer arrived by pasting, 0–100. Staff only. */
  pastedPercent: number;
  mark: number | null;
  feedback: string | null;
  markedByName: string | null;
  markedAt: string | Date | null;
  releasedAt: string | Date | null;
  returnedAt: string | Date | null;
  returnNote: string | null;
}

/** One student's row on the marking page: no answer text, to keep it light. */
export interface AssignmentRosterRowDto {
  studentId: string;
  name: string;
  admissionNumber: string;
  status: WorkStatus;
  /** The latest attempt, when there is one. */
  latestSubmissionId: string | null;
  attempts: number;
  late: boolean;
  mark: number | null;
  released: boolean;
  pastedPercent: number | null;
  /** Files on the latest attempt. */
  fileCount: number;
  /** CP4.3: the automatic mark on the latest attempt, when there are questions. */
  autoMark: number | null;
  /** CP4b: the AI draft on the latest attempt, if any. */
  draftStatus: FeedbackDraftStatus | null;
}

export interface AssignmentMarkingDto {
  assignmentId: string;
  title: string;
  className: string;
  subjectName: string;
  /** CP4.4: what the gradebook push needs — the subject and the current term. */
  subjectId: string;
  termId: string | null;
  dueDate: string;
  collection: AssignmentCollectionDto;
  /** CP4.3: the questions, with their right answers. */
  questions: AssignmentQuestionDto[];
  /** False once anyone has handed in: the questions are fixed from then. */
  questionsEditable: boolean;
  /**
   * CP4b: whether "Draft with AI" is offered — the platform's switch, the
   * school's own, and the plan all allow it. False hides the buttons; marking
   * by hand is the same either way.
   */
  aiDrafting: boolean;
  roster: AssignmentRosterRowDto[];
  counts: { submitted: number; marked: number; released: number; notSubmitted: number };
}

/** One student's attempts, newest first. */
export interface StudentWorkDto {
  assignmentId: string;
  studentId: string;
  studentName: string;
  totalMarks: number;
  attempts: AssignmentSubmissionDto[];
  /** CP4.3: the questions, so each answer can be shown beside its question. */
  questions: AssignmentQuestionDto[];
}

/** The student's own view. No paste counts. */
export interface MyAssignmentAttemptDto {
  attempt: number;
  body: string | null;
  files: SubmissionFileDto[];
  /** CP4.3: what the student answered; `correct` only once released. */
  answers: AnswerResultDto[];
  submittedAt: string | Date;
  late: boolean;
  /** Only once released. */
  mark: number | null;
  feedback: string | null;
  returnNote: string | null;
}

export interface MyAssignmentDto {
  assignmentId: string;
  title: string;
  instructions: string | null;
  subjectName: string;
  dueDate: string;
  totalMarks: number;
  accepting: boolean;
  status: WorkStatus;
  /** Whether the student may hand in now. */
  canSubmit: boolean;
  /** Files attached and waiting to be handed in with the next attempt. */
  stagedFiles: SubmissionFileDto[];
  /** CP4.3: the questions to answer, without their answers. */
  questions: MyAssignmentQuestionDto[];
  attempts: MyAssignmentAttemptDto[];
}

/** One collected assignment, as a family's list shows it. No answer text. */
export interface FamilyAssignmentDto {
  assignmentId: string;
  title: string;
  subjectName: string;
  dueDate: string;
  totalMarks: number;
  status: WorkStatus;
  late: boolean;
  submittedAt: string | Date | null;
  /** Only once released. */
  mark: number | null;
  feedback: string | null;
  returnNote: string | null;
  /** The files handed in with the latest attempt (Q8: the child's guardians may open them). */
  files: SubmissionFileDto[];
}

export interface FamilyAssignmentListResponse {
  data: FamilyAssignmentDto[];
}

// ---------------------------------------------------------------------------
// CP4.4 — the similarity check (CP4-D9). For the teacher only: never shown to
// a student or a parent, never stored, never part of a mark. The words are
// "share a lot of wording", never "plagiarism".
// ---------------------------------------------------------------------------

export const SIMILARITY = {
  /** Overlapping runs of this many words are compared. */
  shingleWords: 5,
  /** Answers shorter than this are skipped: too short to say anything. */
  minWords: 50,
  /** Share of the shorter answer's runs found in the other, 0–1, to be listed. */
  threshold: 0.5,
  /** At most this many pairs are listed, most alike first. */
  maxPairs: 50,
} as const;

/** A stretch of an answer, marked when the other answer has the same wording. */
export interface SimilaritySegmentDto {
  text: string;
  shared: boolean;
}

export interface SimilarityAnswerDto {
  studentId: string;
  name: string;
  segments: SimilaritySegmentDto[];
}

export interface SimilarPairDto {
  /** About how much of the shorter answer's wording is in the other, 0–100. */
  overlapPercent: number;
  a: SimilarityAnswerDto;
  b: SimilarityAnswerDto;
}

export interface SimilarityReportDto {
  assignmentId: string;
  /** Typed answers compared (each student's latest). */
  compared: number;
  /** Typed answers under the minimum length, left out. */
  skippedShort: number;
  pairs: SimilarPairDto[];
}

/** Q7: the share of an answer that arrived by pasting, from the two counts. */
export function pastedPercent(typedChars: number, pastedChars: number): number {
  const total = typedChars + pastedChars;
  if (total <= 0) return 0;
  return Math.round((pastedChars / total) * 100);
}

/** How a status reads, for a student or a parent. */
export function describeWorkStatus(status: WorkStatus): string {
  switch (status) {
    case "NOT_SUBMITTED":
      return "Not handed in";
    case "SUBMITTED":
      return "Handed in";
    case "RETURNED":
      return "Returned to be done again";
    case "MARKED":
      return "Marked";
  }
}

/**
 * How a file is named on its button: "photo", "PDF", or "photo 2" when there
 * is more than one of that kind. The same words on every screen.
 */
export function describeSubmissionFile(files: readonly SubmissionFileDto[], index: number): string {
  const file = files[index]!;
  const sameType = files.filter((f) => f.type === file.type);
  const word = file.type === "pdf" ? "PDF" : "photo";
  return sameType.length === 1 ? word : `${word} ${sameType.indexOf(file) + 1}`;
}
