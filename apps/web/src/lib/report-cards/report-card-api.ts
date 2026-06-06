// Typed wrappers around the Phase 2 / Slice 5 report-card endpoints. Same shape
// as the other lib/<module>-api.ts files — the API returns the DTO directly.
//
// cp1 shipped the data layer + build service; cp2 the render worker + PDF
// endpoints. cp3 (this) wires the admin/form-teacher UI to all of them.

import type {
  BuildReportCardsResultDto,
  RenderArmResultDto,
  ReportCardBoardResponse,
  ReportCardDetailDto,
  ReportCardPdfUrlDto,
  ReportCardStatusDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// GET /report-cards?termId=&classArmId=&status= — the workflow-board feed: one
// row per student in the arm with their card (rollup + workflow + PDF status).
export function getReportCardBoard(
  termId: string,
  classArmId: string,
  status?: ReportCardStatusDto,
): Promise<ReportCardBoardResponse> {
  const params = new URLSearchParams({ termId, classArmId });
  if (status) params.set("status", status);
  return apiFetch<ReportCardBoardResponse>(`/report-cards?${params.toString()}`, {
    method: "GET",
  });
}

// GET /report-cards/:id — one card with its per-subject breakdown + bio.
export function getReportCardById(id: string): Promise<ReportCardDetailDto> {
  return apiFetch<ReportCardDetailDto>(`/report-cards/${id}`, { method: "GET" });
}

// POST /report-cards/arm/build — materialize DRAFT cards from current
// assessments (owner/admin). Returns { cardCount, studentCount }.
export function buildReportCards(
  termId: string,
  classArmId: string,
): Promise<BuildReportCardsResultDto> {
  return apiFetch<BuildReportCardsResultDto>("/report-cards/arm/build", {
    method: "POST",
    body: { termId, classArmId },
  });
}

// POST /report-cards/arm/render — enqueue PDF render jobs (owner/admin). Without
// reportCardId, renders EVERY card in the arm ("Render all PDFs"); with it,
// renders that single card (per-card "Regenerate"). Returns { enqueuedCount }.
export function renderReportCards(
  termId: string,
  classArmId: string,
  reportCardId?: string,
): Promise<RenderArmResultDto> {
  return apiFetch<RenderArmResultDto>("/report-cards/arm/render", {
    method: "POST",
    body: reportCardId ? { termId, classArmId, reportCardId } : { termId, classArmId },
  });
}

// GET /report-cards/:id/pdf — a fresh short-lived signed URL to the rendered
// PDF. 404s until pdfStatus === GENERATED. The signed URL is opened in a new tab
// to download (R2 sets Content-Disposition: attachment).
export function getReportCardPdfUrl(id: string): Promise<ReportCardPdfUrlDto> {
  return apiFetch<ReportCardPdfUrlDto>(`/report-cards/${id}/pdf`, { method: "GET" });
}
