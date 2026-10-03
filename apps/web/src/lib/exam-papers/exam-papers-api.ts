// Typed wrappers around the Phase 8c / CP5c exam paper endpoints
// (docs/modules/phase-8.md §22.3).

import type {
  CreateExamPaperInput,
  DrawQuestionsInput,
  ExamPaperDto,
  ExamPaperExportDto,
  ExamPaperOutOfDto,
  ExamPaperSummaryDto,
  ListExamPapersQuery,
  PaperVersion,
  QuestionDto,
  SaveExamPaperInput,
} from "@school-kit/types";

import { listAcademicYears, listTerms } from "../academic-years/academic-years-api";
import { apiFetch } from "../api-client";
import { getMyScope } from "../teacher/teacher-scope-api";

export function listExamPapers(query: ListExamPapersQuery = {}): Promise<ExamPaperSummaryDto[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  return apiFetch<ExamPaperSummaryDto[]>(`/exam-papers?${params.toString()}`, { method: "GET" });
}

export function getExamPaper(id: string): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>(`/exam-papers/${id}`, { method: "GET" });
}

export function createExamPaper(input: CreateExamPaperInput): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>("/exam-papers", { method: "POST", body: input });
}

/** Replaces a draft's header and its whole section structure. */
export function saveExamPaper(id: string, input: SaveExamPaperInput): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>(`/exam-papers/${id}`, { method: "PUT", body: input });
}

export function finaliseExamPaper(id: string): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>(`/exam-papers/${id}/finalise`, { method: "POST" });
}

export function duplicateExamPaper(id: string): Promise<ExamPaperDto> {
  return apiFetch<ExamPaperDto>(`/exam-papers/${id}/duplicate`, { method: "POST" });
}

export function deleteExamPaper(id: string): Promise<void> {
  return apiFetch<void>(`/exam-papers/${id}`, { method: "DELETE" });
}

export function drawQuestions(input: DrawQuestionsInput): Promise<QuestionDto[]> {
  return apiFetch<QuestionDto[]>("/exam-papers/draw", { method: "POST", body: input });
}

/** One version of a FINAL paper, ready to print or export. The API audits each call. */
export function getExamPaperExport(id: string, version: PaperVersion): Promise<ExamPaperExportDto> {
  return apiFetch<ExamPaperExportDto>(`/exam-papers/${id}/export?version=${version}`, { method: "GET" });
}

/** FINAL papers set for this arm's gradebook columns — their totals pre-fill "Out of". */
export function getExamPaperOutOf(termId: string, classArmId: string, subjectId: string): Promise<ExamPaperOutOfDto> {
  const params = new URLSearchParams({ termId, classArmId, subjectId });
  return apiFetch<ExamPaperOutOfDto>(`/exam-papers/out-of?${params.toString()}`, { method: "GET" });
}

/**
 * The current term, for a teacher OR an owner/admin. Teachers read it from
 * their scope (they cannot list academic years); owner/admin are refused that
 * teacher-only endpoint, so they read the current year's terms instead.
 */
export async function getCurrentTermForStaff(): Promise<{ id: string; name: string } | null> {
  try {
    const mine = await getMyScope();
    return mine.currentTerm ? { id: mine.currentTerm.id, name: mine.currentTerm.name } : null;
  } catch {
    const year = (await listAcademicYears()).find((y) => y.isCurrent);
    if (!year) return null;
    const term = (await listTerms(year.id)).find((t) => t.isCurrent);
    return term ? { id: term.id, name: term.name } : null;
  }
}
