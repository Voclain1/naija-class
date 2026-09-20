import type {
  FormCommentRowDto,
  GenerateFormCommentsInput,
  GenerateFormCommentsResultDto,
  ListFormCommentsInput,
  ReportCardDto,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP7 (1) — the form teacher's overall comment: one comment per child on the
// report card, as distinct from CP6b's per-subject comments.
//
// The same AI approval gate applies, and the split between the endpoints is
// what enforces it: `form/generate` only ever produces a SUGGESTION, and the
// write is a PATCH on the report card itself. Note that the comments surface
// deliberately does NOT proxy that write — `PATCH /report-cards/:id` owns it,
// with its own auth, workflow-status gate and audit row — which is why
// `FormCommentRowDto` carries `reportCardId` for the client to use.

export function staffListFormComments(
  query: ListFormCommentsInput,
): Promise<FormCommentRowDto[]> {
  const params = new URLSearchParams({
    classArmId: query.classArmId,
    termId: query.termId,
  });
  return apiFetch<FormCommentRowDto[]>(`/report-card-comments/form?${params.toString()}`);
}

export function staffGenerateFormComments(
  input: GenerateFormCommentsInput,
): Promise<GenerateFormCommentsResultDto> {
  return apiFetch<GenerateFormCommentsResultDto>("/report-card-comments/form/generate", {
    method: "POST",
    body: input,
  });
}

/**
 * Save the form teacher's comment onto one report card.
 *
 * `editable: false` on the row mirrors the workflow gate the API applies, so
 * the screen can refuse for the same reason rather than guessing from a status
 * string — but the API remains the authority and will refuse a frozen card.
 */
export function staffSaveFormComment(
  reportCardId: string,
  formTeacherComment: string,
): Promise<ReportCardDto> {
  return apiFetch<ReportCardDto>(`/report-cards/${encodeURIComponent(reportCardId)}`, {
    method: "PATCH",
    body: { formTeacherComment },
  });
}
