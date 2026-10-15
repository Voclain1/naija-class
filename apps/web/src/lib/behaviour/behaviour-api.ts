// Typed wrapper around /behaviour (docs/modules/the-school-day.md Part C).
//
// Staff only. There is no portal equivalent of this file and no endpoint for
// one: these records are internal in v1 (C14).

import type {
  BehaviourCategoryDto,
  BehaviourIncidentDto,
  BehaviourIncidentListResponse,
  BehaviourIncidentOptionsDto,
  BehaviourIncidentRosterDto,
  CreateBehaviourIncidentInput,
  BehaviourListResponse,
  BehaviourRecordDto,
  BehaviourSettingsDto,
  CreateBehaviourCategoryInput,
  CreateBehaviourInput,
  UpdateBehaviourCategoryInput,
  CreateDisciplineActionInput,
  DecideDisciplineActionInput,
  DisciplineActionDto,
  DisciplineActionStatus,
  DisciplineListResponse,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listBehaviour(studentId: string): Promise<BehaviourListResponse> {
  return apiFetch<BehaviourListResponse>(`/behaviour?studentId=${encodeURIComponent(studentId)}`);
}

export function createBehaviour(input: CreateBehaviourInput): Promise<BehaviourRecordDto> {
  return apiFetch<BehaviourRecordDto>("/behaviour", { method: "POST", body: input });
}

export function withdrawBehaviour(id: string): Promise<BehaviourRecordDto> {
  return apiFetch<BehaviourRecordDto>(`/behaviour/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

// Phase 9 / CP2.1 — points (docs/modules/phase-9.md §9 CP2-D1). Reading is for
// every writer; the three writes are owner/admin only on the server.

export function getBehaviourSettings(): Promise<BehaviourSettingsDto> {
  return apiFetch<BehaviourSettingsDto>("/behaviour/settings");
}

export function updateBehaviourSettings(pointsEnabled: boolean): Promise<BehaviourSettingsDto> {
  return apiFetch<BehaviourSettingsDto>("/behaviour/settings", { method: "PATCH", body: { pointsEnabled } });
}

export function createBehaviourCategory(input: CreateBehaviourCategoryInput): Promise<BehaviourCategoryDto> {
  return apiFetch<BehaviourCategoryDto>("/behaviour/categories", { method: "POST", body: input });
}

export function updateBehaviourCategory(id: string, input: UpdateBehaviourCategoryInput): Promise<BehaviourCategoryDto> {
  return apiFetch<BehaviourCategoryDto>(`/behaviour/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

// Phase 9 / CP2.2 — incidents (docs/modules/phase-9.md §9 CP2-D2). Scope is
// the server's: a teacher's options and list come back already narrowed.

export function getIncidentOptions(): Promise<BehaviourIncidentOptionsDto> {
  return apiFetch<BehaviourIncidentOptionsDto>("/behaviour/incident-options");
}

export function getIncidentRoster(armId: string): Promise<BehaviourIncidentRosterDto> {
  return apiFetch<BehaviourIncidentRosterDto>(`/behaviour/incident-options/arms/${encodeURIComponent(armId)}/students`);
}

export function listIncidents(): Promise<BehaviourIncidentListResponse> {
  return apiFetch<BehaviourIncidentListResponse>("/behaviour/incidents");
}

export function createIncident(input: CreateBehaviourIncidentInput): Promise<BehaviourIncidentDto> {
  return apiFetch<BehaviourIncidentDto>("/behaviour/incidents", { method: "POST", body: input });
}

export function withdrawIncident(id: string): Promise<BehaviourIncidentDto> {
  return apiFetch<BehaviourIncidentDto>(`/behaviour/incidents/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

// Phase 9 / CP2.3 — discipline (docs/modules/phase-9.md §9 CP2-D3). A teacher
// proposes and withdraws their own; an owner or admin decides. The server
// refuses anyone deciding their own proposal.

export function listDiscipline(params: { studentId?: string; status?: DisciplineActionStatus } = {}): Promise<DisciplineListResponse> {
  const query = new URLSearchParams();
  if (params.studentId) query.set("studentId", params.studentId);
  if (params.status) query.set("status", params.status);
  const qs = query.toString();
  return apiFetch<DisciplineListResponse>(`/behaviour/discipline${qs ? `?${qs}` : ""}`);
}

export function proposeDiscipline(input: CreateDisciplineActionInput): Promise<DisciplineActionDto> {
  return apiFetch<DisciplineActionDto>("/behaviour/discipline", { method: "POST", body: input });
}

export function decideDiscipline(id: string, input: DecideDisciplineActionInput): Promise<DisciplineActionDto> {
  return apiFetch<DisciplineActionDto>(`/behaviour/discipline/${encodeURIComponent(id)}/decide`, { method: "POST", body: input });
}

export function withdrawDiscipline(id: string): Promise<DisciplineActionDto> {
  return apiFetch<DisciplineActionDto>(`/behaviour/discipline/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}
