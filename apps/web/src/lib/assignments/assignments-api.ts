// Typed wrapper around /assignments (Phase 9 / CP4, docs/modules/phase-9.md
// §11): collecting work on a homework item, and marking what students hand in.
// Owner, admin and the class's teachers; never the bursar.

import type {
  AssignmentFileUrlDto,
  AssignmentMarkingDto,
  BankQuestionListResponse,
  CollectWorkInput,
  SetAssignmentQuestionsInput,
  SimilarityReportDto,
  AiMarkingSettingsDto,
  DraftFeedbackResultDto,
  MarkSubmissionInput,
  ReturnSubmissionInput,
  StudentWorkDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

const enc = encodeURIComponent;

export function collectWork(homeworkId: string, input: CollectWorkInput): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/collection`, { method: "PUT", body: input });
}

export function getMarking(homeworkId: string): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/submissions`);
}

export function getStudentWork(homeworkId: string, studentId: string): Promise<StudentWorkDto> {
  return apiFetch<StudentWorkDto>(`/assignments/${enc(homeworkId)}/students/${enc(studentId)}`);
}

export function markSubmission(submissionId: string, input: MarkSubmissionInput): Promise<StudentWorkDto> {
  return apiFetch<StudentWorkDto>(`/assignments/submissions/${enc(submissionId)}/mark`, { method: "POST", body: input });
}

export function returnSubmission(submissionId: string, input: ReturnSubmissionInput): Promise<StudentWorkDto> {
  return apiFetch<StudentWorkDto>(`/assignments/submissions/${enc(submissionId)}/return`, { method: "POST", body: input });
}

export function releaseMarks(homeworkId: string): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/release`, { method: "POST" });
}

// Phase 9 / CP4.2 — a five-minute link to a handed-in photo or PDF, audited.
export function getAssignmentFileUrl(fileId: string): Promise<AssignmentFileUrlDto> {
  return apiFetch<AssignmentFileUrlDto>(`/assignments/files/${enc(fileId)}`);
}

// Phase 9 / CP4.3 — questions marked automatically.
export function setQuestions(homeworkId: string, input: SetAssignmentQuestionsInput): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/questions`, { method: "PUT", body: input });
}

export function getBankQuestions(homeworkId: string): Promise<BankQuestionListResponse> {
  return apiFetch<BankQuestionListResponse>(`/assignments/${enc(homeworkId)}/bank-questions`);
}

export function applyAutoMarks(homeworkId: string): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/auto-marks`, { method: "POST" });
}

// Phase 9 / CP4.4 — which typed answers share a lot of wording. Staff only,
// audited, never stored.
export function checkSimilarity(homeworkId: string): Promise<SimilarityReportDto> {
  return apiFetch<SimilarityReportDto>(`/assignments/${enc(homeworkId)}/similarity`, { method: "POST" });
}

// Phase 9 / CP4b — AI drafts of marking feedback. Optional at every level:
// the school's own switch (owner/admin), then a teacher's button. A draft is
// never a mark; only "Save mark" writes one.
export function getAiMarkingSettings(): Promise<AiMarkingSettingsDto> {
  return apiFetch<AiMarkingSettingsDto>("/assignments/ai-drafts/settings");
}

export function updateAiMarkingSettings(enabled: boolean): Promise<AiMarkingSettingsDto> {
  return apiFetch<AiMarkingSettingsDto>("/assignments/ai-drafts/settings", { method: "PUT", body: { enabled } });
}

export function draftAllFeedback(homeworkId: string): Promise<DraftFeedbackResultDto> {
  return apiFetch<DraftFeedbackResultDto>(`/assignments/${enc(homeworkId)}/ai-drafts`, { method: "POST" });
}

export function draftFeedback(submissionId: string): Promise<DraftFeedbackResultDto> {
  return apiFetch<DraftFeedbackResultDto>(`/assignments/submissions/${enc(submissionId)}/ai-draft`, { method: "POST" });
}

export function discardFeedbackDraft(submissionId: string): Promise<void> {
  return apiFetch<void>(`/assignments/submissions/${enc(submissionId)}/ai-draft`, { method: "DELETE" });
}
