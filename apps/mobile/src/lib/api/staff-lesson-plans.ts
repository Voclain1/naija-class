import type {
  CreateLessonPlanInput,
  LessonPlanDto,
  LessonPlanSummaryDto,
  UpdateLessonPlanInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP7 (4) — lesson notes.
//
// D25: generation is SYNCHRONOUS. `POST /lesson-plans` runs a Sonnet call and
// blocks for 10-30 seconds; there is no queued variant today, and adding one
// is a server change CP7 deliberately does not make. Two consequences the
// screen must carry rather than hide:
//
//   - The request has to survive the wait, so the teacher is warned BEFORE
//     starting not to leave the screen or switch apps.
//   - `signal` exists so the teacher can cancel. Cancelling aborts the HTTP
//     request; it does NOT reach into the server and stop the model, so the
//     school may still be charged for work already done. The screen says so —
//     a cancel that implies a refund it cannot deliver is worse than none.

export function staffListLessonPlans(): Promise<LessonPlanSummaryDto[]> {
  // `mine` defaults to the caller's own plans server-side. A teacher's list is
  // their own work; widening it is an admin concern and not this surface's.
  return apiFetch<LessonPlanSummaryDto[]>("/lesson-plans");
}

export function staffGetLessonPlan(id: string): Promise<LessonPlanDto> {
  return apiFetch<LessonPlanDto>(`/lesson-plans/${encodeURIComponent(id)}`);
}

export function staffCreateLessonPlan(
  input: CreateLessonPlanInput,
  signal?: AbortSignal,
): Promise<LessonPlanDto> {
  return apiFetch<LessonPlanDto>("/lesson-plans", {
    method: "POST",
    body: input,
    signal,
  });
}

export function staffGenerateQuiz(id: string, signal?: AbortSignal): Promise<LessonPlanDto> {
  // A second generation against an existing plan — same wait, same warning.
  return apiFetch<LessonPlanDto>(`/lesson-plans/${encodeURIComponent(id)}/quiz`, {
    method: "POST",
    signal,
  });
}

export function staffUpdateLessonPlan(
  id: string,
  input: UpdateLessonPlanInput,
): Promise<LessonPlanDto> {
  // Per-section save: every field is optional server-side precisely so one
  // section can be saved without a read-modify-write race against another.
  return apiFetch<LessonPlanDto>(`/lesson-plans/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}
