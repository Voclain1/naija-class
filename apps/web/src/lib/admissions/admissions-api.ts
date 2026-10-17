import type {
  AdmissionDetailDto,
  AdmissionListDto,
  AdmissionOfficerDto,
  AdmissionSettingsDto,
  AdmissionStatus,
  UpdateAdmissionSettingsInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Phase 9 / CP7.1 — admissions (docs/modules/phase-9.md §16, §16.8).

const id = (value: string) => encodeURIComponent(value);

export const getAdmissionSettings = () => apiFetch<AdmissionSettingsDto>("/admissions/settings", { method: "GET" });
export const updateAdmissionSettings = (body: UpdateAdmissionSettingsInput) =>
  apiFetch<AdmissionSettingsDto>("/admissions/settings", { method: "PUT", body });
export const getAdmissionOfficers = () => apiFetch<AdmissionOfficerDto[]>("/admissions/officers", { method: "GET" });
export const setAdmissionOfficers = (userIds: string[]) =>
  apiFetch<AdmissionOfficerDto[]>("/admissions/officers", { method: "PUT", body: { userIds } });

export const listAdmissions = (status: AdmissionStatus, classLevelId?: string) =>
  apiFetch<AdmissionListDto>(`/admissions/applications?${new URLSearchParams({ status, ...(classLevelId ? { classLevelId } : {}) })}`, {
    method: "GET",
  });
export const getAdmission = (applicationId: string) =>
  apiFetch<AdmissionDetailDto>(`/admissions/applications/${id(applicationId)}`, { method: "GET" });
export const admissionDocumentUrl = (applicationId: string, documentId: string) =>
  apiFetch<{ url: string }>(`/admissions/applications/${id(applicationId)}/documents/${id(documentId)}/url`, { method: "GET" });
