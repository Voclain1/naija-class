import type {
  HealthProfileDto,
  HealthStudentListResponse,
  TeacherHealthNoteForStudentDto,
  TeacherHealthNotesResponse,
  UpdateHealthProfileInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Phase 9 / CP3.1 — health records (docs/modules/phase-9.md §10). The record
// routes are owner, admin and Health officer; the note routes return the
// "For teachers" note only.

export function staffHealthList(params: { q?: string; armId?: string }): Promise<HealthStudentListResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.armId) query.set("armId", params.armId);
  const qs = query.toString();
  return apiFetch<HealthStudentListResponse>(`/health/students${qs ? `?${qs}` : ""}`);
}

export function staffHealthProfile(studentId: string): Promise<HealthProfileDto> {
  return apiFetch<HealthProfileDto>(`/health/students/${encodeURIComponent(studentId)}`);
}

export function saveStaffHealthProfile(studentId: string, input: UpdateHealthProfileInput): Promise<HealthProfileDto> {
  return apiFetch<HealthProfileDto>(`/health/students/${encodeURIComponent(studentId)}`, { method: "PUT", body: input });
}

export function staffHealthNote(studentId: string): Promise<TeacherHealthNoteForStudentDto> {
  return apiFetch<TeacherHealthNoteForStudentDto>(`/health/teacher-notes/students/${encodeURIComponent(studentId)}`);
}

export function staffClassHealthNotes(armId: string): Promise<TeacherHealthNotesResponse> {
  return apiFetch<TeacherHealthNotesResponse>(`/health/teacher-notes?armId=${encodeURIComponent(armId)}`);
}
