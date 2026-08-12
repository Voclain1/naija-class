// Typed wrappers around the Phase 5 / Slice 2 lesson-plan endpoints.
// Mirrors apps/web/src/lib/subjects/subjects-api.ts.
//
// NOTE on latency: createLessonPlan and generateQuiz are NOT ordinary CRUD
// calls — each runs a real Sonnet generation server-side and can take 10-30
// seconds. Callers must show progress and must not use an optimistic-update
// pattern that assumes a fast round trip.

import type {
  CreateLessonPlanInput,
  LessonPlanDto,
  LessonPlanSummaryDto,
  UpdateLessonPlanInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listLessonPlans(
  options: { classLevelId?: string; subjectId?: string; mine?: boolean } = {},
): Promise<LessonPlanSummaryDto[]> {
  const params = new URLSearchParams();
  if (options.classLevelId) params.set("classLevelId", options.classLevelId);
  if (options.subjectId) params.set("subjectId", options.subjectId);
  if (options.mine === false) params.set("mine", "false");
  const qs = params.toString();
  return apiFetch<LessonPlanSummaryDto[]>(`/lesson-plans${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export function getLessonPlan(id: string): Promise<LessonPlanDto> {
  return apiFetch<LessonPlanDto>(`/lesson-plans/${id}`, { method: "GET" });
}

// Creates the row AND runs the generation. Slow — see the note above.
export function createLessonPlan(input: CreateLessonPlanInput): Promise<LessonPlanDto> {
  return apiFetch<LessonPlanDto>("/lesson-plans", { method: "POST", body: input });
}

// A second generation against an existing plan. Also slow.
export function generateLessonQuiz(id: string): Promise<LessonPlanDto> {
  return apiFetch<LessonPlanDto>(`/lesson-plans/${id}/quiz`, { method: "POST" });
}

export function updateLessonPlan(
  id: string,
  input: UpdateLessonPlanInput,
): Promise<LessonPlanDto> {
  return apiFetch<LessonPlanDto>(`/lesson-plans/${id}`, { method: "PATCH", body: input });
}

export function deleteLessonPlan(id: string): Promise<void> {
  return apiFetch<void>(`/lesson-plans/${id}`, { method: "DELETE" });
}
