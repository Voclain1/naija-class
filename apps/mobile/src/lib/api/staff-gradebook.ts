import type {
  AssessmentDto,
  AssessmentFeedResponse,
  BulkAssessmentScoreInput,
  GradingSchemeDto,
  ScorePreviewResponse,
  SignOffBulkInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP6a teacher gradebook bindings (docs/modules/staff-mobile-companion.md).
//
// Like CP2 and CP3, every endpoint here already exists and backs the shipped
// web teacher gradebook. CP6a adds no server surface. Scoping — a column
// outside the teacher's (arm, subject) is a 404, a score above the component's
// weight is a 400 bound to its row, a released report card is a 409 — lives in
// AssessmentService and is NOT reimplemented here: the phone renders what the
// server allows.

export function staffGradingScheme(): Promise<GradingSchemeDto> {
  return apiFetch<GradingSchemeDto>("/grading-scheme");
}

export function staffGradebookFeed(
  termId: string,
  classArmId: string,
  subjectId: string,
): Promise<AssessmentFeedResponse> {
  const query = new URLSearchParams({ termId, classArmId, subjectId });
  return apiFetch<AssessmentFeedResponse>(`/assessments?${query.toString()}`);
}

/**
 * What each row would be saved as, without saving (phase-8.md D60). The app
 * shows this before a save that carries raw marks; the save sends the same
 * rows and the server recomputes, never trusting a client-scaled figure.
 */
export function staffPreviewScores(input: BulkAssessmentScoreInput): Promise<ScorePreviewResponse> {
  return apiFetch<ScorePreviewResponse>("/assessment-scores/preview", {
    method: "POST",
    body: input,
  });
}

export function staffSaveScores(input: BulkAssessmentScoreInput): Promise<AssessmentFeedResponse> {
  // Atomic all-or-nothing, and it returns the refreshed column. No retry and
  // no queue: a failed save must reach the screen as a failure while the
  // teacher's marks stay on it, unsaved.
  return apiFetch<AssessmentFeedResponse>("/assessment-scores/bulk", {
    method: "POST",
    body: input,
  });
}

export function staffSignOffColumn(input: SignOffBulkInput): Promise<AssessmentDto[]> {
  return apiFetch<AssessmentDto[]>("/assessments/sign-off/bulk", {
    method: "POST",
    body: input,
  });
}
