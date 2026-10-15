// Typed wrapper around /health (Phase 9 / CP3.1, docs/modules/phase-9.md §10).
//
// The record routes are owner, admin and Health officer. The teacher-note
// routes return the "For teachers" note only.

import type {
  CreateVaccinationInput,
  HealthDocumentUrlDto,
  HealthProfileDto,
  HealthStudentListResponse,
  TeacherHealthNoteForStudentDto,
  TeacherHealthNotesResponse,
  UpdateHealthProfileInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listHealthStudents(params: { q?: string; armId?: string } = {}): Promise<HealthStudentListResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.armId) query.set("armId", params.armId);
  const qs = query.toString();
  return apiFetch<HealthStudentListResponse>(`/health/students${qs ? `?${qs}` : ""}`);
}

export function getHealthProfile(studentId: string): Promise<HealthProfileDto> {
  return apiFetch<HealthProfileDto>(`/health/students/${encodeURIComponent(studentId)}`);
}

export function saveHealthProfile(studentId: string, input: UpdateHealthProfileInput): Promise<HealthProfileDto> {
  return apiFetch<HealthProfileDto>(`/health/students/${encodeURIComponent(studentId)}`, { method: "PUT", body: input });
}

export function getClassHealthNotes(armId: string): Promise<TeacherHealthNotesResponse> {
  return apiFetch<TeacherHealthNotesResponse>(`/health/teacher-notes?armId=${encodeURIComponent(armId)}`);
}

export function getStudentHealthNote(studentId: string): Promise<TeacherHealthNoteForStudentDto> {
  return apiFetch<TeacherHealthNoteForStudentDto>(`/health/teacher-notes/students/${encodeURIComponent(studentId)}`);
}

// Phase 9 / CP3.2 — vaccinations and their documents (F1).

export function addVaccination(studentId: string, input: CreateVaccinationInput): Promise<HealthProfileDto> {
  return apiFetch<HealthProfileDto>(`/health/students/${encodeURIComponent(studentId)}/vaccinations`, {
    method: "POST",
    body: input,
  });
}

export function withdrawVaccination(id: string): Promise<HealthProfileDto> {
  return apiFetch<HealthProfileDto>(`/health/vaccinations/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

// multipart/form-data: no Content-Type set here, the browser adds the boundary.
export function uploadVaccinationDocument(id: string, file: File): Promise<HealthProfileDto> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<HealthProfileDto>(`/health/vaccinations/${encodeURIComponent(id)}/document`, { method: "POST", body: form });
}

export function getVaccinationDocumentUrl(id: string): Promise<HealthDocumentUrlDto> {
  return apiFetch<HealthDocumentUrlDto>(`/health/vaccinations/${encodeURIComponent(id)}/document`);
}
