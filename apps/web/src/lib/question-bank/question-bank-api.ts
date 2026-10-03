// Typed wrappers around the Phase 8c / CP5b question bank endpoints
// (docs/modules/phase-8.md §22.2). Same shape as the other lib/<module>-api.ts
// files — the API returns the DTO directly.

import type {
  CreateQuestionInput,
  GenerateQuestionsInput,
  GenerateQuestionsResponse,
  ListQuestionsQuery,
  QuestionDto,
  QuestionScopeDto,
  UpdateQuestionInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

/** The (class level, subject) pairs the caller may work on. */
export function getQuestionScope(): Promise<QuestionScopeDto> {
  return apiFetch<QuestionScopeDto>("/questions/scope", { method: "GET" });
}

export function listQuestions(query: ListQuestionsQuery): Promise<QuestionDto[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  return apiFetch<QuestionDto[]>(`/questions?${params.toString()}`, { method: "GET" });
}

export function createQuestion(input: CreateQuestionInput): Promise<QuestionDto> {
  return apiFetch<QuestionDto>("/questions", { method: "POST", body: input });
}

/** For an approved question this returns a NEW draft revision, not the same id. */
export function updateQuestion(id: string, input: UpdateQuestionInput): Promise<QuestionDto> {
  return apiFetch<QuestionDto>(`/questions/${id}`, { method: "PATCH", body: input });
}

export function approveQuestion(id: string): Promise<QuestionDto> {
  return apiFetch<QuestionDto>(`/questions/${id}/approve`, { method: "POST" });
}

export function retireQuestion(id: string): Promise<QuestionDto> {
  return apiFetch<QuestionDto>(`/questions/${id}/retire`, { method: "POST" });
}

export function discardQuestion(id: string): Promise<void> {
  return apiFetch<void>(`/questions/${id}`, { method: "DELETE" });
}

/** AI drafting. Spends the school's AI budget; every question returned is a DRAFT. */
export function generateQuestions(input: GenerateQuestionsInput): Promise<GenerateQuestionsResponse> {
  return apiFetch<GenerateQuestionsResponse>("/questions/generate", { method: "POST", body: input });
}
