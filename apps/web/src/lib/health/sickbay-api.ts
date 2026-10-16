// Typed wrapper around /health/sickbay (Phase 9 / CP3.3, docs/modules/phase-9.md
// §10 CP3-D5). Owner, admin and the Health officer only (sickbay.manage).

import type {
  AddSickbayMedicationInput,
  CreateSickbayVisitInput,
  SickbayVisitDto,
  SickbayVisitListResponse,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

/** One Lagos day's visits, or one child's. Neither means today. */
export function listSickbayVisits(params: { date?: string; studentId?: string } = {}): Promise<SickbayVisitListResponse> {
  const query = new URLSearchParams();
  if (params.date) query.set("date", params.date);
  if (params.studentId) query.set("studentId", params.studentId);
  const qs = query.toString();
  return apiFetch<SickbayVisitListResponse>(`/health/sickbay/visits${qs ? `?${qs}` : ""}`);
}

export function recordSickbayVisit(input: CreateSickbayVisitInput): Promise<SickbayVisitDto> {
  return apiFetch<SickbayVisitDto>("/health/sickbay/visits", { method: "POST", body: input });
}

export function addSickbayMedication(visitId: string, input: AddSickbayMedicationInput): Promise<SickbayVisitDto> {
  return apiFetch<SickbayVisitDto>(`/health/sickbay/visits/${encodeURIComponent(visitId)}/medications`, {
    method: "POST",
    body: input,
  });
}

export function withdrawSickbayVisit(visitId: string): Promise<SickbayVisitDto> {
  return apiFetch<SickbayVisitDto>(`/health/sickbay/visits/${encodeURIComponent(visitId)}/withdraw`, { method: "POST" });
}
