// Typed wrappers around the Phase 1 / Slice 3 class-arms endpoints.
// Mirrors class-levels-api.ts. ClassArm uses the slice-1 nested-create /
// flat-edit convention: POST goes under the parent level, PATCH/DELETE
// take the bare id.

import type {
  ClassArmDto,
  CreateClassArmInput,
  UpdateClassArmInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listClassArms(
  options: { includeInactive?: boolean } = {},
): Promise<ClassArmDto[]> {
  const qs = options.includeInactive ? "?includeInactive=true" : "";
  return apiFetch<ClassArmDto[]>(`/class-arms${qs}`, { method: "GET" });
}

export function listArmsForLevel(
  classLevelId: string,
  options: { includeInactive?: boolean } = {},
): Promise<ClassArmDto[]> {
  const qs = options.includeInactive ? "?includeInactive=true" : "";
  return apiFetch<ClassArmDto[]>(
    `/class-levels/${classLevelId}/class-arms${qs}`,
    { method: "GET" },
  );
}

export function createClassArm(
  classLevelId: string,
  input: CreateClassArmInput,
): Promise<ClassArmDto> {
  return apiFetch<ClassArmDto>(`/class-levels/${classLevelId}/class-arms`, {
    method: "POST",
    body: input,
  });
}

export function updateClassArm(
  id: string,
  input: UpdateClassArmInput,
): Promise<ClassArmDto> {
  return apiFetch<ClassArmDto>(`/class-arms/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteClassArm(id: string): Promise<void> {
  return apiFetch<void>(`/class-arms/${id}`, { method: "DELETE" });
}
