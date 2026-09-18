import type {
  AcceptSubjectCommentInput,
  GenerateSubjectCommentsInput,
  GenerateSubjectCommentsResultDto,
  ListSubjectCommentsInput,
  SubjectCommentRowDto,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP6b — report-card subject comments (docs/modules/staff-mobile-companion.md).
//
// Three endpoints, all pre-existing behind the web teacher gradebook, and the
// division between them IS the AI approval gate CLAUDE.md's hard rule
// requires: `generate` only ever produces a SUGGESTION (it lives in
// ai_interaction_logs, not on the report card), and `accept` is the single
// endpoint in the codebase that writes Assessment.subjectComment. The phone
// never writes a comment by any other route, and never accepts on the
// teacher's behalf.

export function staffListSubjectComments(
  query: ListSubjectCommentsInput,
): Promise<SubjectCommentRowDto[]> {
  const params = new URLSearchParams({
    classArmId: query.classArmId,
    subjectId: query.subjectId,
    termId: query.termId,
  });
  return apiFetch<SubjectCommentRowDto[]>(`/report-card-comments?${params.toString()}`);
}

export function staffGenerateSubjectComments(
  input: GenerateSubjectCommentsInput,
): Promise<GenerateSubjectCommentsResultDto> {
  // A receipt, not a result: one job per eligible student is enqueued and the
  // suggestions land later. The screen polls the list for them.
  return apiFetch<GenerateSubjectCommentsResultDto>("/report-card-comments/generate", {
    method: "POST",
    body: input,
  });
}

export function staffAcceptSubjectComment(
  input: AcceptSubjectCommentInput,
): Promise<SubjectCommentRowDto> {
  // The teacher's edited text is what is sent, never the stored suggestion —
  // so an accepted comment is what the teacher actually approved.
  return apiFetch<SubjectCommentRowDto>("/report-card-comments/accept", {
    method: "POST",
    body: input,
  });
}
