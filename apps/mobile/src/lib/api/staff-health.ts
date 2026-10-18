import type {
  CreateSickbayVisitInput,
  CreateVaccinationInput,
  SickbayVisitDto,
  SickbayVisitListResponse,
  HealthDocumentUrlDto,
  HealthProfileDto,
  HealthStudentListResponse,
  TeacherHealthNoteForStudentDto,
  TeacherHealthNotesResponse,
  UpdateHealthProfileInput,
} from "@school-kit/types";

import { apiFetch } from "./client";
import { uploadMultipart } from "./native-upload";

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

// Phase 9 / CP3.2 — vaccinations and their documents (F1).

export function addStaffVaccination(studentId: string, input: CreateVaccinationInput): Promise<HealthProfileDto> {
  return apiFetch<HealthProfileDto>(`/health/students/${encodeURIComponent(studentId)}/vaccinations`, {
    method: "POST",
    body: input,
  });
}

export function withdrawStaffVaccination(id: string): Promise<HealthProfileDto> {
  return apiFetch<HealthProfileDto>(`/health/vaccinations/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

/** Streams the file from disk through the native uploader (see native-upload.ts). */
export function uploadStaffVaccinationDocument(id: string, fileUri: string, mimeType: string): Promise<HealthProfileDto> {
  return uploadMultipart<HealthProfileDto>(`/health/vaccinations/${encodeURIComponent(id)}/document`, {
    fileUri,
    fieldName: "file",
    mimeType,
    parameters: {},
  });
}

export function staffVaccinationDocumentUrl(id: string): Promise<HealthDocumentUrlDto> {
  return apiFetch<HealthDocumentUrlDto>(`/health/vaccinations/${encodeURIComponent(id)}/document`);
}

// Phase 9 / CP3.3 — the sickbay log (sickbay.manage: owner, admin, Health officer).

export function staffSickbayVisits(studentId: string): Promise<SickbayVisitListResponse> {
  return apiFetch<SickbayVisitListResponse>(`/health/sickbay/visits?studentId=${encodeURIComponent(studentId)}`);
}

// CP11.2 (docs/modules/phase-9.md §20): one day's visits, for the day list.
export function staffSickbayDay(day: string): Promise<SickbayVisitListResponse> {
  return apiFetch<SickbayVisitListResponse>(`/health/sickbay/visits?date=${encodeURIComponent(day)}`);
}

export function recordStaffSickbayVisit(input: CreateSickbayVisitInput): Promise<SickbayVisitDto> {
  return apiFetch<SickbayVisitDto>("/health/sickbay/visits", { method: "POST", body: input });
}

export function withdrawStaffSickbayVisit(visitId: string): Promise<SickbayVisitDto> {
  return apiFetch<SickbayVisitDto>(`/health/sickbay/visits/${encodeURIComponent(visitId)}/withdraw`, { method: "POST" });
}
