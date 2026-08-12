// Typed wrappers around the Phase 5 / Slice 3 report-card comment endpoints.
//
// NOTE ON TIMING: `generateSubjectComments` returns as soon as the batch is
// ENQUEUED — it is not the result. Each student's comment is a separate Haiku
// call on a worker, so a 40-student arm lands over minutes. Callers poll
// `listSubjectComments` and watch suggestions appear; there is no completion
// callback and deliberately no job-status table (the slice adds no model).

import type {
  AcceptSubjectCommentInput,
  GenerateSubjectCommentsInput,
  GenerateSubjectCommentsResultDto,
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
