// Typed wrappers around the Phase 1 / Slice 1 endpoints. Same shape as
// users-api.ts.

import type {
  AcademicYearDto,
  CreateAcademicYearInput,
  CreateTermInput,
  TermDto,
  UpdateAcademicYearInput,
  UpdateTermInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// ---------- academic years ----------

export function listAcademicYears(): Promise<AcademicYearDto[]> {
  return apiFetch<AcademicYearDto[]>("/academic-years", { method: "GET" });
}

export function getAcademicYear(id: string): Promise<AcademicYearDto> {
  return apiFetch<AcademicYearDto>(`/academic-years/${id}`, { method: "GET" });
}

export function createAcademicYear(
  input: CreateAcademicYearInput,
): Promise<AcademicYearDto> {
  return apiFetch<AcademicYearDto>("/academic-years", {
    method: "POST",
    body: input,
  });
}

export function updateAcademicYear(
  id: string,
  input: UpdateAcademicYearInput,
): Promise<AcademicYearDto> {
  return apiFetch<AcademicYearDto>(`/academic-years/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteAcademicYear(id: string): Promise<void> {
  return apiFetch<void>(`/academic-years/${id}`, { method: "DELETE" });
}

export function setCurrentAcademicYear(id: string): Promise<AcademicYearDto> {
  return apiFetch<AcademicYearDto>(`/academic-years/${id}/set-current`, {
    method: "POST",
  });
}

// ---------- terms ----------

export function listTerms(academicYearId: string): Promise<TermDto[]> {
  return apiFetch<TermDto[]>(`/academic-years/${academicYearId}/terms`, {
    method: "GET",
  });
}

export function createTerm(
  academicYearId: string,
  input: CreateTermInput,
): Promise<TermDto> {
  return apiFetch<TermDto>(`/academic-years/${academicYearId}/terms`, {
    method: "POST",
    body: input,
  });
}

export function updateTerm(id: string, input: UpdateTermInput): Promise<TermDto> {
  return apiFetch<TermDto>(`/terms/${id}`, { method: "PATCH", body: input });
}

export function deleteTerm(id: string): Promise<void> {
  return apiFetch<void>(`/terms/${id}`, { method: "DELETE" });
}

export function setCurrentTerm(id: string): Promise<TermDto> {
  return apiFetch<TermDto>(`/terms/${id}/set-current`, { method: "POST" });
}
