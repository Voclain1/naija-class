import { z } from "zod";

// Phase 9 / CP4 — assignments: submitted work and marking
// (docs/modules/phase-9.md §11).
//
// "Collect work" is switched on for one homework item. Students hand in a
// typed answer (CP4.1); files and questions come in CP4.2 and CP4.3.
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
} as const;

/** Switch "collect work" on for a homework item, or change its settings. */
export const collectWorkSchema = z
  .object({
    totalMarks: z.number().int().min(1, "Give the work a total mark.").max(ASSIGNMENT_LIMITS.totalMarks),
    accepting: z.boolean().optional(),
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
  })
  .strict();
export type MarkSubmissionInput = z.input<typeof markSubmissionSchema>;

export const returnSubmissionSchema = z
  .object({
    note: z.string().trim().min(1, "Tell the student what to change.").max(ASSIGNMENT_LIMITS.returnNote),
  })
  .strict();
export type ReturnSubmissionInput = z.infer<typeof returnSubmissionSchema>;

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
}

export interface AssignmentMarkingDto {
  assignmentId: string;
  title: string;
  className: string;
  subjectName: string;
  dueDate: string;
  collection: AssignmentCollectionDto;
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
}

/** The student's own view. No paste counts. */
export interface MyAssignmentAttemptDto {
  attempt: number;
  body: string | null;
  files: SubmissionFileDto[];
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
