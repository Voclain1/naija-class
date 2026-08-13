import { z } from "zod";

// Form teacher's report-card comments — Phase 5 / Slice 4.
//
// The unit is (student, term): one holistic comment per report card, written by
// the form teacher after the subject teachers have signed off.
//
// NOTE WHAT IS ABSENT HERE: there is no accept endpoint and no accept DTO.
// Unlike the subject comment (slice 3), the write path already existed before
// this slice — `PATCH /report-cards/:id` (editFormTeacherComment) has enforced
// owner/admin-or-form-teacher, the DRAFT/SUBJECT_REVIEWED status gate, the
// released-card guard and an audit row since Phase 2. Acceptance goes through
// that endpoint unchanged, so this slice adds only the SUGGESTION half. Adding
// a second write path beside an audited one would have been strictly worse.

// POST /report-card-comments/form/generate — whole arm, one job per card.
export const generateFormCommentsSchema = z
  .object({
    classArmId: z.string().uuid(),
    termId: z.string().uuid(),
  })
  .strict();

export type GenerateFormCommentsInput = z.infer<typeof generateFormCommentsSchema>;

export interface GenerateFormCommentsResultDto {
  sessionRef: string;
  queued: number;
  // Cards past DRAFT/SUBJECT_REVIEWED (FORM_REVIEWED, PRINCIPAL_APPROVED,
  // RELEASED). The comment is frozen at those states, so a draft would be one
  // the teacher cannot save — skipped rather than generated and wasted.
  skippedLocked: number;
  // Cards with no subject results yet: nothing to interpret, and inventing a
  // comment from an empty grade table is exactly what the prompt forbids.
  skippedNoResults: number;
}

// GET /report-card-comments/form?classArmId=&termId=
export const listFormCommentsSchema = z
  .object({
    classArmId: z.string().uuid(),
    termId: z.string().uuid(),
  })
  .strict();

export type ListFormCommentsInput = z.infer<typeof listFormCommentsSchema>;

// One row per report card in the arm. Carries no student name or admission
// number — the screen this renders on already holds the roster, so duplicating
// identity onto an AI surface would widen the PII footprint for nothing.
export interface FormCommentRowDto {
  studentId: string;
  // The client needs this to call PATCH /report-cards/:id when the teacher
  // accepts — this surface deliberately does not proxy that write.
  reportCardId: string;
  suggestion: string | null;
  suggestedAt: string | Date | null;
  // The persisted form teacher's comment, whatever its origin.
  comment: string | null;
  // Mirrors the workflow's own gate so the UI can disable editing for the same
  // reason the API would refuse it, rather than guessing from status strings.
  editable: boolean;
  overallAverage: number | null;
  overallPosition: number | null;
}
