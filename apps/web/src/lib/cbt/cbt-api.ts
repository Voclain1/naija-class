// Typed wrappers around the online exam (CBT) staff endpoints
// (docs/modules/cbt.md).

import type {
  CbtCandidateRowDto,
  CbtInvigilatorSheetDto,
  CbtResultsDto,
  CbtSchedulablePaperDto,
  CbtSittingDto,
  CbtSittingSummaryDto,
  CreateCbtSittingInput,
  SaveCbtTheoryMarksInput,
  UpdateCbtSittingInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export const listSchedulablePapers = () => apiFetch<CbtSchedulablePaperDto[]>("/cbt/papers", { method: "GET" });

export const listCbtSittings = () => apiFetch<CbtSittingSummaryDto[]>("/cbt/sittings", { method: "GET" });

export const getCbtSitting = (id: string) => apiFetch<CbtSittingDto>(`/cbt/sittings/${id}`, { method: "GET" });

export const listCbtCandidates = (id: string) => apiFetch<CbtCandidateRowDto[]>(`/cbt/sittings/${id}/candidates`, { method: "GET" });

/** The codes. Every call is audited on the server. */
export const getInvigilatorSheet = (id: string) =>
  apiFetch<CbtInvigilatorSheetDto>(`/cbt/sittings/${id}/invigilator-sheet`, { method: "GET" });

export const createCbtSitting = (input: CreateCbtSittingInput) =>
  apiFetch<CbtSittingDto>("/cbt/sittings", { method: "POST", body: input });

export const updateCbtSitting = (id: string, input: UpdateCbtSittingInput) =>
  apiFetch<CbtSittingDto>(`/cbt/sittings/${id}`, { method: "PUT", body: input });

export const deleteCbtSitting = (id: string) => apiFetch<void>(`/cbt/sittings/${id}`, { method: "DELETE" });

export const publishCbtSitting = (id: string) => apiFetch<CbtSittingDto>(`/cbt/sittings/${id}/publish`, { method: "POST" });

export const unpublishCbtSitting = (id: string) => apiFetch<CbtSittingDto>(`/cbt/sittings/${id}/unpublish`, { method: "POST" });

export const closeCbtSitting = (id: string) => apiFetch<CbtSittingDto>(`/cbt/sittings/${id}/close`, { method: "POST" });

// ---- Results (CBT3) -------------------------------------------------------

/** Marked on the server against the frozen key, every time. */
export const getCbtResults = (id: string) => apiFetch<CbtResultsDto>(`/cbt/sittings/${id}/results`, { method: "GET" });

export const saveCbtTheoryMarks = (id: string, input: SaveCbtTheoryMarksInput) =>
  apiFetch<CbtResultsDto>(`/cbt/sittings/${id}/theory-marks`, { method: "PUT", body: input });

/** The attempt that counts, for a student who used more than one computer. */
export const chooseCbtAttempt = (id: string, attemptId: string) =>
  apiFetch<CbtResultsDto>(`/cbt/sittings/${id}/attempts/${attemptId}/choose`, { method: "POST" });

/** Where lab machines open the exam (D9). Set per deployment; dev default is the local CBT app. */
export const CBT_DELIVERY_BASE_URL = process.env.NEXT_PUBLIC_CBT_URL ?? "http://localhost:3003";
