// Typed wrapper around /behaviour (docs/modules/the-school-day.md Part C).
//
// Staff only. There is no portal equivalent of this file and no endpoint for
// one: these records are internal in v1 (C14).

import type {
  BehaviourCategoryDto,
  BehaviourListResponse,
  BehaviourRecordDto,
  BehaviourSettingsDto,
  CreateBehaviourCategoryInput,
  CreateBehaviourInput,
  UpdateBehaviourCategoryInput,
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
