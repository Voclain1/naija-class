// Typed wrappers around the Phase 5 / Slice 3 report-card comment endpoints.
//
// NOTE ON TIMING: `generateSubjectComments` returns as soon as the batch is
// ENQUEUED — it is not the result. Each student's comment is a separate Haiku
// call on a worker, so a 40-student arm lands over minutes. Callers poll
// `listSubjectComments` and watch suggestions appear; there is no completion
// callback and deliberately no job-status table (the slice adds no model).

import type {
  AcceptSubjectCommentInput,
  FormCommentRowDto,
  GenerateFormCommentsInput,
  GenerateFormCommentsResultDto,
  GenerateSubjectCommentsInput,
  GenerateSubjectCommentsResultDto,
  ListFormCommentsInput,
  ListSubjectCommentsInput,
  SubjectCommentRowDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listSubjectComments(
  query: ListSubjectCommentsInput,
): Promise<SubjectCommentRowDto[]> {
  const params = new URLSearchParams({
    classArmId: query.classArmId,
    subjectId: query.subjectId,
    termId: query.termId,
  });
  return apiFetch<SubjectCommentRowDto[]>(`/report-card-comments?${params.toString()}`, {
    method: "GET",
  });
}

// Enqueues; does not generate synchronously. See the note above.
export function generateSubjectComments(
  input: GenerateSubjectCommentsInput,
): Promise<GenerateSubjectCommentsResultDto> {
  return apiFetch<GenerateSubjectCommentsResultDto>("/report-card-comments/generate", {
    method: "POST",
    body: input,
  });
}

// The teacher-approval gate: the only call that writes the comment onto the
// student's report card.
export function acceptSubjectComment(
  input: AcceptSubjectCommentInput,
): Promise<SubjectCommentRowDto> {
  return apiFetch<SubjectCommentRowDto>("/report-card-comments/accept", {
    method: "POST",
    body: input,
  });
}

// --- Form teacher's comment (slice 4) --------------------------------------
//
// There is deliberately no `acceptFormComment` here. That write already has a
// client — `updateFormTeacherComment` in lib/report-cards/report-card-api.ts,
// hitting PATCH /report-cards/:id, which has carried the auth, status gate and
// audit row since Phase 2. The AI surface drafts; the existing endpoint accepts.

export function listFormComments(query: ListFormCommentsInput): Promise<FormCommentRowDto[]> {
  const params = new URLSearchParams({ classArmId: query.classArmId, termId: query.termId });
  return apiFetch<FormCommentRowDto[]>(`/report-card-comments/form?${params.toString()}`, {
    method: "GET",
  });
}

// Enqueues one job per eligible card; returns a receipt, not results.
export function generateFormComments(
  input: GenerateFormCommentsInput,
): Promise<GenerateFormCommentsResultDto> {
  return apiFetch<GenerateFormCommentsResultDto>("/report-card-comments/form/generate", {
    method: "POST",
    body: input,
  });
}
