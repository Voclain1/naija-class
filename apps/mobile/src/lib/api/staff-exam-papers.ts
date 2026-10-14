import type {
  CreateExamPaperInput,
  DrawQuestionsInput,
  ExamPaperDto,
  ExamPaperExportDto,
  ExamPaperSummaryDto,
  ListQuestionsQuery,
  PaperVersion,
  QuestionDto,
  QuestionScopeDto,
  SaveExamPaperInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Exam papers, staff side (docs/modules/phase-8.md §22.3) — the website's
// apps/web/src/lib/exam-papers/exam-papers-api.ts, for the phone. Every
// endpoint already exists and backs the web teacher pages; the phone adds no
// server surface. Scoping (a teacher only sets papers for the subjects they
// teach at each level, D62) and the FINAL freeze live in the API and the
// database, not here.

export function staffExamPapers(): Promise<ExamPaperSummaryDto[]> {
  return apiFetch<ExamPaperSummaryDto[]>("/exam-papers");
}

export function staffExamPaper(id: string): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>(`/exam-papers/${encodeURIComponent(id)}`);
}

export function staffCreateExamPaper(input: CreateExamPaperInput): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>("/exam-papers", { method: "POST", body: input });
}

/** Replaces a draft's header and its whole section structure. */
export function staffSaveExamPaper(id: string, input: SaveExamPaperInput): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>(`/exam-papers/${encodeURIComponent(id)}`, { method: "PUT", body: input });
}

export function staffFinaliseExamPaper(id: string): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>(`/exam-papers/${encodeURIComponent(id)}/finalise`, { method: "POST" });
}

export function staffDuplicateExamPaper(id: string): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>(`/exam-papers/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
}

export function staffDeleteExamPaper(id: string): Promise<void> {
  return apiFetch<void>(`/exam-papers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Unused approved questions of a type (and topic), picked at random by the server. */
export function staffDrawExamQuestions(input: DrawQuestionsInput): Promise<QuestionDto[]> {
  return apiFetch<QuestionDto[]>("/exam-papers/draw", { method: "POST", body: input });
}

/** One version of a FINAL paper, ready to print or export. The API audits each call. */
export function staffExamPaperExport(id: string, version: PaperVersion): Promise<ExamPaperExportDto> {
  const query = new URLSearchParams({ version });
  return apiFetch<ExamPaperExportDto>(`/exam-papers/${encodeURIComponent(id)}/export?${query.toString()}`);
}

// The two question-bank reads the paper screens need: which classes and
// subjects the caller may set a paper for, and the approved questions the
// picker offers. Kept here, under their own names, so exam papers do not
// depend on the question-bank screens' bindings.

/** The (class level, subject) pairs the caller may work on. */
export function staffPaperQuestionScope(): Promise<QuestionScopeDto> {
  return apiFetch<QuestionScopeDto>("/questions/scope");
}

export function staffPaperBankQuestions(query: ListQuestionsQuery): Promise<QuestionDto[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  return apiFetch<QuestionDto[]>(`/questions?${params.toString()}`);
}
