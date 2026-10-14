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

import { apiFetch } from "./client";

// Online exams (CBT) — the staff endpoints the website's /teacher/cbt pages use
// (apps/web/src/lib/cbt/cbt-api.ts, docs/modules/cbt.md). NOT the public
// cbt-delivery routes the lab computers call: the phone schedules and reads
// results, it never sits an exam.
//
// Permissions are the server's (cbt.read to read, cbt.manage for everything
// else, D62 teacher scope); the phone only decides what to offer.

/** Final papers with multiple-choice questions that can be scheduled. cbt.manage. */
export const staffCbtPapers = () => apiFetch<CbtSchedulablePaperDto[]>("/cbt/papers");

export const staffCbtSittings = () => apiFetch<CbtSittingSummaryDto[]>("/cbt/sittings");

export const staffCbtSitting = (id: string) => apiFetch<CbtSittingDto>(`/cbt/sittings/${encodeURIComponent(id)}`);

export const staffCbtCandidates = (id: string) =>
  apiFetch<CbtCandidateRowDto[]>(`/cbt/sittings/${encodeURIComponent(id)}/candidates`);

/**
 * The access and unlock codes. Every call is audited on the server
 * (cbt-sitting.view-codes, D3), so call it only when a person opens the sheet,
 * and keep the answer in screen memory — never in the query cache or on disk.
 */
export const staffCbtInvigilatorSheet = (id: string) =>
  apiFetch<CbtInvigilatorSheetDto>(`/cbt/sittings/${encodeURIComponent(id)}/invigilator-sheet`);

export const staffCreateCbtSitting = (input: CreateCbtSittingInput) =>
  apiFetch<CbtSittingDto>("/cbt/sittings", { method: "POST", body: input });

export const staffUpdateCbtSitting = (id: string, input: UpdateCbtSittingInput) =>
  apiFetch<CbtSittingDto>(`/cbt/sittings/${encodeURIComponent(id)}`, { method: "PUT", body: input });

export const staffDeleteCbtSitting = (id: string) =>
  apiFetch<void>(`/cbt/sittings/${encodeURIComponent(id)}`, { method: "DELETE" });

export const staffPublishCbtSitting = (id: string) =>
  apiFetch<CbtSittingDto>(`/cbt/sittings/${encodeURIComponent(id)}/publish`, { method: "POST" });

export const staffUnpublishCbtSitting = (id: string) =>
  apiFetch<CbtSittingDto>(`/cbt/sittings/${encodeURIComponent(id)}/unpublish`, { method: "POST" });

export const staffCloseCbtSitting = (id: string) =>
  apiFetch<CbtSittingDto>(`/cbt/sittings/${encodeURIComponent(id)}/close`, { method: "POST" });

// ---- Results (CBT3) ---------------------------------------------------------

/** Marked on the server against the frozen key, every time. */
export const staffCbtResults = (id: string) => apiFetch<CbtResultsDto>(`/cbt/sittings/${encodeURIComponent(id)}/results`);

/** All or nothing. Returns the refreshed results. */
export const staffSaveCbtTheoryMarks = (id: string, input: SaveCbtTheoryMarksInput) =>
  apiFetch<CbtResultsDto>(`/cbt/sittings/${encodeURIComponent(id)}/theory-marks`, { method: "PUT", body: input });

/** The attempt that counts, for a student who used more than one computer. */
export const staffChooseCbtAttempt = (id: string, attemptId: string) =>
  apiFetch<CbtResultsDto>(
    `/cbt/sittings/${encodeURIComponent(id)}/attempts/${encodeURIComponent(attemptId)}/choose`,
    { method: "POST" },
  );

// ---- Sending totals to the gradebook (D8) -----------------------------------
// The same CP5a calls the website's results page uses: preview writes nothing
// and shows each "12/15 → 48"; the save sends the same rows and the server
// scales them again. The gradebook's own bindings, under this screen's names.

export { staffPreviewScores as staffCbtPreviewGradebook, staffSaveScores as staffCbtSaveToGradebook } from "./staff-gradebook";
