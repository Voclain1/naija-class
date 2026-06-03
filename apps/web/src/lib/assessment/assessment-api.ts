// Typed wrappers around the Phase 2 / Slice 2 assessment endpoints the teacher
// gradebook calls. Same shape as the other lib/<module>-api.ts files — the API
// returns the DTO directly. The grid also reads the grading scheme (column
// defs + weights) via lib/grading/grading-api.ts and the teacher's scope +
// current term via lib/teacher/teacher-scope-api.ts.
//
// cp1 wires the read path (getGradebookFeed). The write wrappers
// (bulkSaveScores, signOffColumn) land in cp2.

import type {
  AggregateInput,
  AggregateResultDto,
  AggregateStatusResponse,
  AssessmentDto,
  AssessmentFeedResponse,
  BulkAssessmentScoreInput,
  SignOffBulkInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// GET /assessments?termId=&classArmId=&subjectId= — one gradebook column:
// every enrolled student with their materialized summary + per-component scores.
export function getGradebookFeed(
  termId: string,
  classArmId: string,
  subjectId: string,
): Promise<AssessmentFeedResponse> {
  const params = new URLSearchParams({ termId, classArmId, subjectId });
  return apiFetch<AssessmentFeedResponse>(`/assessments?${params.toString()}`, {
    method: "GET",
  });
}

// POST /assessment-scores/bulk — one atomic column save. Returns the refreshed
// feed (with re-materialized totals/grades) on 200; throws ApiError carrying
// { issues: [{ path: ['rows', i, 'score'], message }] } in `details` on 400.
export function bulkSaveScores(
  input: BulkAssessmentScoreInput,
): Promise<AssessmentFeedResponse> {
  return apiFetch<AssessmentFeedResponse>("/assessment-scores/bulk", {
    method: "POST",
    body: input,
  });
}

// POST /assessments/sign-off/bulk — sign off the whole column. Returns the
// updated assessments on 200; throws ApiError with a per-student missing-score
// list in `details` on 400 (when the column isn't fully scored).
export function signOffColumn(input: SignOffBulkInput): Promise<AssessmentDto[]> {
  return apiFetch<AssessmentDto[]>("/assessments/sign-off/bulk", {
    method: "POST",
    body: input,
  });
}

// POST /assessments/aggregate — recompute positions. The gradebook calls the
// SUBJECT-NARROWED form (subjectId set) for the form teacher's "Recompute
// positions" action.
export function aggregateScores(input: AggregateInput): Promise<AggregateResultDto> {
  return apiFetch<AggregateResultDto>("/assessments/aggregate", {
    method: "POST",
    body: input,
  });
}

// GET /assessments/aggregate/status — when positions were last computed.
export function getAggregateStatus(
  termId: string,
  classArmId: string,
): Promise<AggregateStatusResponse> {
  const params = new URLSearchParams({ termId, classArmId });
  return apiFetch<AggregateStatusResponse>(`/assessments/aggregate/status?${params.toString()}`, {
    method: "GET",
  });
}
