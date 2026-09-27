// Typed wrapper around /behaviour (docs/modules/the-school-day.md Part C).
//
// Staff only. There is no portal equivalent of this file and no endpoint for
// one: these records are internal in v1 (C14).

import type {
  BehaviourListResponse,
  BehaviourRecordDto,
  CreateBehaviourInput,
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
