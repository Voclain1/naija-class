import type {
  AdmissionDetailDto,
  AdmissionListDto,
  AdmissionOfficerDto,
  AdmissionSettingsDto,
  AdmissionStatus,
  AdmitApplicationInput,
  AdmitApplicationResultDto,
  BookAdmissionAssessmentInput,
  StudentAdmissionDocumentsDto,
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

// CP7.2 — decisions and Admit.
const app = (applicationId: string, step: string) => `/admissions/applications/${id(applicationId)}/${step}`;
export const reviewAdmission = (applicationId: string) => apiFetch<void>(app(applicationId, "review"), { method: "POST" });
export const bookAdmissionAssessment = (applicationId: string, body: BookAdmissionAssessmentInput) =>
  apiFetch<void>(app(applicationId, "assessment"), { method: "PUT", body });
export const offerAdmission = (applicationId: string, letter: string) => apiFetch<void>(app(applicationId, "offer"), { method: "POST", body: { letter } });
export const rejectAdmission = (applicationId: string, note?: string) =>
  apiFetch<void>(app(applicationId, "reject"), { method: "POST", body: note ? { note } : {} });
export const withdrawAdmission = (applicationId: string) => apiFetch<void>(app(applicationId, "withdraw"), { method: "POST" });
export const recordAdmissionAcceptance = (applicationId: string) =>
  apiFetch<void>(app(applicationId, "accept"), { method: "POST", body: { familySawLetter: true } });
export const admitApplication = (applicationId: string, body: AdmitApplicationInput) =>
  apiFetch<AdmitApplicationResultDto>(app(applicationId, "admit"), { method: "POST", body });

export const getStudentAdmissionDocuments = (studentId: string) =>
  apiFetch<StudentAdmissionDocumentsDto | null>(`/admissions/students/${id(studentId)}/documents`, { method: "GET" });
export const studentAdmissionDocumentUrl = (studentId: string, documentId: string) =>
  apiFetch<{ url: string }>(`/admissions/students/${id(studentId)}/documents/${id(documentId)}/url`, { method: "GET" });
