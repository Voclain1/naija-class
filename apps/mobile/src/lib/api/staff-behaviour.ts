import type {
  BehaviourListResponse,
  BehaviourRecordDto,
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
