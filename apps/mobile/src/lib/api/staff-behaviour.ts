import type {
  BehaviourIncidentDto,
  BehaviourIncidentOptionsDto,
  BehaviourIncidentRosterDto,
  CreateBehaviourIncidentInput,
  BehaviourListResponse,
  BehaviourRecordDto,
  BehaviourSettingsDto,
  CreateBehaviourInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Behaviour records, staff only (docs/modules/the-school-day.md Part C).
//
// There is no guardian or student equivalent of this file, and there is no
// endpoint for one either: these records are internal in v1 (C14).

export function staffBehaviour(studentId: string): Promise<BehaviourListResponse> {
  return apiFetch<BehaviourListResponse>(`/behaviour?studentId=${encodeURIComponent(studentId)}`);
}

export function createStaffBehaviour(input: CreateBehaviourInput): Promise<BehaviourRecordDto> {
  return apiFetch<BehaviourRecordDto>("/behaviour", { method: "POST", body: input });
}

export function withdrawStaffBehaviour(id: string): Promise<BehaviourRecordDto> {
  return apiFetch<BehaviourRecordDto>(`/behaviour/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

/** Phase 9 / CP2.1 — whether points are on, and the categories to offer. */
export function staffBehaviourSettings(): Promise<BehaviourSettingsDto> {
  return apiFetch<BehaviourSettingsDto>("/behaviour/settings");
}

/** Phase 9 / CP2.2 — the classes and staff the incident form offers. */
export function staffIncidentOptions(): Promise<BehaviourIncidentOptionsDto> {
  return apiFetch<BehaviourIncidentOptionsDto>("/behaviour/incident-options");
}

export function staffIncidentRoster(armId: string): Promise<BehaviourIncidentRosterDto> {
  return apiFetch<BehaviourIncidentRosterDto>(`/behaviour/incident-options/arms/${encodeURIComponent(armId)}/students`);
}

export function createStaffIncident(input: CreateBehaviourIncidentInput): Promise<BehaviourIncidentDto> {
  return apiFetch<BehaviourIncidentDto>("/behaviour/incidents", { method: "POST", body: input });
}
