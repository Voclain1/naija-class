import { z } from "zod";

// Report-card subject comments — Phase 5 / Slice 3.
//
// The unit is (student, subject, term): one comment per subject on a student's
// termly report card, written into `Assessment.subjectComment`. There is no new
// model in this slice — the suggestion lives in `ai_interaction_logs` until a
// teacher accepts it, and acceptance writes the existing column (phase-5.md
// D15, so "was this AI-drafted or teacher-written?" stays answerable).

// POST /report-card-comments/generate — enqueues one generation per student in
// the arm. Deliberately whole-arm rather than per-student: the teacher's real
// action is "draft comments for this class", and a per-student endpoint would
// have the UI fire 40 requests that each cost money and can each fail
// separately.
export const generateSubjectCommentsSchema = z
  .object({
    classArmId: z.string().uuid(),
    subjectId: z.string().uuid(),
    termId: z.string().uuid(),
  })
  .strict();

export type GenerateSubjectCommentsInput = z.infer<typeof generateSubjectCommentsSchema>;

export interface GenerateSubjectCommentsResultDto {
  // Groups this batch's rows in ai_interaction_logs. Stable for a given
  // (term, arm, subject) so a re-run overwrites the previous batch's
  // suggestions rather than accumulating orphans.
  sessionRef: string;
  // How many students were enqueued. Zero is a legitimate result (an arm with
  // no enrolled students, or every student already signed off).
  queued: number;
  // Students skipped because their assessment is already signed off. Surfaced
  // rather than silently dropped: "I clicked generate and 6 students got
  // nothing" needs an answer in the UI.
  skippedSignedOff: number;
  // Students skipped because they have no scores at all this term — there is
  // nothing for the model to interpret, and a comment invented from an empty
  // score set is exactly the fabrication the prompt forbids.
  skippedNoScores: number;
}

// GET /report-card-comments?classArmId=&subjectId=&termId=
export const listSubjectCommentsSchema = z
  .object({
    classArmId: z.string().uuid(),
    subjectId: z.string().uuid(),
    termId: z.string().uuid(),
  })
  .strict();

export type ListSubjectCommentsInput = z.infer<typeof listSubjectCommentsSchema>;

// One row per student. Deliberately carries NO student name or admission
// number: the only screen that renders this already holds the roster (it is
// the gradebook for the same arm/subject/term), so duplicating identity fields
// onto an AI surface would widen the PII footprint for no gain.
export interface SubjectCommentRowDto {
  studentId: string;
  // The current AI suggestion, if one has been generated and not yet accepted.
  // Null while a batch is still running — the UI polls this endpoint and
  // treats null-with-a-live-batch as "still generating".
  suggestion: string | null;
  suggestedAt: string | Date | null;
  // The persisted comment on the report card. Set only by an explicit accept.
  comment: string | null;
  // Non-null once the subject is signed off for this student: the comment is
  // frozen and both generate and accept refuse.
  signedOffAt: string | Date | null;
  // Enough context for the teacher to judge a suggestion without leaving the
  // screen. Already visible on the gradebook this attaches to.
  totalScore: number | null;
  letterGrade: string | null;
}

// POST /report-card-comments/accept — the teacher-approval gate CLAUDE.md's AI
// hard rule requires for report-card comments.
//
// `comment` is sent by the client rather than the server copying the stored
// suggestion, because the teacher can edit before accepting and the edited
// text is what must land in the record. The suggestion row stays in
// ai_interaction_logs either way, so the AI-drafted origin is still auditable
// even when the teacher rewrote every word.
export const acceptSubjectCommentSchema = z
  .object({
    studentId: z.string().uuid(),
    subjectId: z.string().uuid(),
    termId: z.string().uuid(),
    // Upper bound matches what a report card layout can physically hold; the
    // prompt asks for 20-40 words, and this leaves room for a teacher who
    // wants to write more by hand.
    comment: z.string().trim().min(1).max(1000),
  })
  .strict();

export type AcceptSubjectCommentInput = z.infer<typeof acceptSubjectCommentSchema>;
