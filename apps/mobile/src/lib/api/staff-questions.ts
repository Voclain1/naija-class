import type {
  CreateQuestionInput,
  GenerateQuestionsInput,
  GenerateQuestionsResponse,
  ListQuestionsQuery,
  QuestionDto,
  QuestionScopeDto,
  UpdateQuestionInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// The question bank, staff side (Phase 8c / CP5b, docs/modules/phase-8.md
// §22.2). The same endpoints and shapes as apps/web's
// lib/question-bank/question-bank-api.ts. The server enforces scope (D62):
// a teacher only ever sees the (class level, subject) pairs they teach.

/** The (class level, subject) pairs the caller may work on. */
export function staffQuestionScope(): Promise<QuestionScopeDto> {
  return apiFetch<QuestionScopeDto>("/questions/scope");
}

export function staffQuestions(query: ListQuestionsQuery): Promise<QuestionDto[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  const qs = params.toString();
  return apiFetch<QuestionDto[]>(`/questions${qs ? `?${qs}` : ""}`);
}

export function staffQuestion(id: string): Promise<QuestionDto> {
  return apiFetch<QuestionDto>(`/questions/${encodeURIComponent(id)}`);
}

export function createStaffQuestion(input: CreateQuestionInput): Promise<QuestionDto> {
  return apiFetch<QuestionDto>("/questions", { method: "POST", body: input });
}

/** For an approved question this returns a NEW draft revision, not the same id. */
export function updateStaffQuestion(id: string, input: UpdateQuestionInput): Promise<QuestionDto> {
  return apiFetch<QuestionDto>(`/questions/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export function approveStaffQuestion(id: string): Promise<QuestionDto> {
  return apiFetch<QuestionDto>(`/questions/${encodeURIComponent(id)}/approve`, { method: "POST" });
}

export function retireStaffQuestion(id: string): Promise<QuestionDto> {
  return apiFetch<QuestionDto>(`/questions/${encodeURIComponent(id)}/retire`, { method: "POST" });
}

export function discardStaffQuestion(id: string): Promise<void> {
  return apiFetch<void>(`/questions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** AI drafting. Spends the school's AI budget; every question returned is a DRAFT. */
export function generateStaffQuestions(input: GenerateQuestionsInput): Promise<GenerateQuestionsResponse> {
  return apiFetch<GenerateQuestionsResponse>("/questions/generate", { method: "POST", body: input });
}
