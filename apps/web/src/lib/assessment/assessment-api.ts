// Typed wrappers around the Phase 2 / Slice 2 assessment endpoints the teacher
// gradebook calls. Same shape as the other lib/<module>-api.ts files — the API
// returns the DTO directly. The grid also reads the grading scheme (column
// defs + weights) via lib/grading/grading-api.ts and the teacher's scope +
// current term via lib/teacher/teacher-scope-api.ts.
//
// cp1 wires the read path (getGradebookFeed). The write wrappers
// (bulkSaveScores, signOffColumn) land in cp2.

import type { AssessmentFeedResponse } from "@school-kit/types";

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
