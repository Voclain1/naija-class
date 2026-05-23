// Typed wrappers around the Phase 1 / Slice 2 class-levels endpoints.
// Mirrors apps/web/src/lib/academic-years/academic-years-api.ts.

import type {
  ClassLevelDto,
  CreateClassLevelInput,
  UpdateClassLevelInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listClassLevels(
  options: { includeInactive?: boolean } = {},
): Promise<ClassLevelDto[]> {
  const qs = options.includeInactive ? "?includeInactive=true" : "";
  return apiFetch<ClassLevelDto[]>(`/class-levels${qs}`, { method: "GET" });
}

export function getClassLevel(id: string): Promise<ClassLevelDto> {
  return apiFetch<ClassLevelDto>(`/class-levels/${id}`, { method: "GET" });
}

export function createClassLevel(
  input: CreateClassLevelInput,
): Promise<ClassLevelDto> {
  return apiFetch<ClassLevelDto>("/class-levels", { method: "POST", body: input });
}

export function updateClassLevel(
  id: string,
  input: UpdateClassLevelInput,
): Promise<ClassLevelDto> {
  return apiFetch<ClassLevelDto>(`/class-levels/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteClassLevel(id: string): Promise<void> {
  return apiFetch<void>(`/class-levels/${id}`, { method: "DELETE" });
}
