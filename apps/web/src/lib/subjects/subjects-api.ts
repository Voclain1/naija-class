// Typed wrappers around the Phase 1 / Slice 3 subjects endpoints.
// Subject is a flat school-scoped catalogue — straight CRUD, no nesting.

import type {
  CreateSubjectInput,
  SubjectDto,
  UpdateSubjectInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listSubjects(
  options: { includeInactive?: boolean } = {},
): Promise<SubjectDto[]> {
  const qs = options.includeInactive ? "?includeInactive=true" : "";
  return apiFetch<SubjectDto[]>(`/subjects${qs}`, { method: "GET" });
}

export function createSubject(input: CreateSubjectInput): Promise<SubjectDto> {
  return apiFetch<SubjectDto>("/subjects", { method: "POST", body: input });
}

export function updateSubject(
  id: string,
  input: UpdateSubjectInput,
): Promise<SubjectDto> {
  return apiFetch<SubjectDto>(`/subjects/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteSubject(id: string): Promise<void> {
  return apiFetch<void>(`/subjects/${id}`, { method: "DELETE" });
}
