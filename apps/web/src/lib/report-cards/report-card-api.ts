// Typed wrappers around the Phase 2 / Slice 5 report-card endpoints. Same shape
// as the other lib/<module>-api.ts files — the API returns the DTO directly.
//
// cp1 shipped the data layer + build service; cp2 the render worker + PDF
// endpoints. cp3 (this) wires the admin/form-teacher UI to all of them.

import type {
  BuildReportCardsResultDto,
  PrincipalNoteResultDto,
  RenderArmResultDto,
  ReportCardBoardResponse,
  ReportCardDetailDto,
  ReportCardDto,
  ReportCardPdfUrlDto,
  ReportCardStatusDto,
  ReportCardTransitionResultDto,
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

// ---- Slice 6 cp3: workflow transitions + comment editing -----------------

// POST /report-cards/arm/form-review — DRAFT/SUBJECT_REVIEWED → FORM_REVIEWED
// (owner/admin OR the arm's form teacher).
export function formReviewArm(termId: string, classArmId: string): Promise<ReportCardTransitionResultDto> {
  return apiFetch<ReportCardTransitionResultDto>("/report-cards/arm/form-review", {
    method: "POST",
    body: { termId, classArmId },
  });
}

// POST /report-cards/arm/approve — FORM_REVIEWED → PRINCIPAL_APPROVED (owner/admin).
export function approveArm(termId: string, classArmId: string): Promise<ReportCardTransitionResultDto> {
  return apiFetch<ReportCardTransitionResultDto>("/report-cards/arm/approve", {
    method: "POST",
    body: { termId, classArmId },
  });
}

// POST /report-cards/arm/release — PRINCIPAL_APPROVED → RELEASED + enqueue render
// jobs (owner/admin). Cards go pdfStatus PENDING; the board polls them to GENERATED.
export function releaseArm(termId: string, classArmId: string): Promise<ReportCardTransitionResultDto> {
  return apiFetch<ReportCardTransitionResultDto>("/report-cards/arm/release", {
    method: "POST",
    body: { termId, classArmId },
  });
}

// POST /report-cards/arm/reopen — audited rollback to DRAFT (OWNER only). Reason
// required. 409 ARM_RENDER_IN_FLIGHT if a render is mid-flight.
export function reopenArm(termId: string, classArmId: string, reason: string): Promise<ReportCardTransitionResultDto> {
  return apiFetch<ReportCardTransitionResultDto>("/report-cards/arm/reopen", {
    method: "POST",
    body: { termId, classArmId, reason },
  });
}

// PATCH /report-cards/:id — per-card form-teacher comment (owner/admin OR form
// teacher; editable in DRAFT/SUBJECT_REVIEWED). null clears it.
export function updateFormTeacherComment(reportCardId: string, formTeacherComment: string | null): Promise<ReportCardDto> {
  return apiFetch<ReportCardDto>(`/report-cards/${reportCardId}`, {
    method: "PATCH",
    body: { formTeacherComment },
  });
}

// PUT /report-cards/arm/principal-note — the arm-term note, fanned out to every
// card (owner/admin; editable in FORM_REVIEWED). null clears it.
export function updatePrincipalNote(termId: string, classArmId: string, principalNote: string | null): Promise<PrincipalNoteResultDto> {
  return apiFetch<PrincipalNoteResultDto>("/report-cards/arm/principal-note", {
    method: "PUT",
    body: { termId, classArmId, principalNote },
  });
}
