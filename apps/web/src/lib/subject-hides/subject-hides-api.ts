// Hidden subjects (2026-11-02, docs/modules/subjects-by-class.md).

import type { CreateSubjectHideInput, SubjectHideDto } from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listSubjectHides(options: { current?: boolean; classArmId?: string } = {}): Promise<SubjectHideDto[]> {
  const qs = new URLSearchParams();
  if (options.current) qs.set("current", "true");
  if (options.classArmId) qs.set("classArmId", options.classArmId);
  const q = qs.toString();
  return apiFetch<SubjectHideDto[]>(`/subject-hides${q ? `?${q}` : ""}`, { method: "GET" });
}

export function createSubjectHide(input: CreateSubjectHideInput): Promise<SubjectHideDto> {
  return apiFetch<SubjectHideDto>("/subject-hides", { method: "POST", body: input });
}

export function unhideSubject(id: string): Promise<SubjectHideDto> {
  return apiFetch<SubjectHideDto>(`/subject-hides/${id}/unhide`, { method: "POST" });
}
