// Typed wrappers around the Phase 1 / Slice 9 enrollments endpoints.
//
// All endpoints are admin/owner-gated server-side; the web UI surfaces only
// /enrollments routes inside (admin) so the wrappers do not need to be
// per-role.

import type {
  BulkCreateEnrollmentInput,
  BulkEnrollmentResponse,
  CreateEnrollmentInput,
  EnrollmentDto,
  EnrollmentListResponse,
  ListEnrollmentsQuery,
  UpdateEnrollmentInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

function buildListQuery(query: ListEnrollmentsQuery): string {
  const params = new URLSearchParams();
  if (query.termId) params.set("termId", query.termId);
  if (query.academicYearId) params.set("academicYearId", query.academicYearId);
  if (query.classArmId) params.set("classArmId", query.classArmId);
  if (query.studentId) params.set("studentId", query.studentId);
  if (query.status) params.set("status", query.status);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listEnrollments(
  query: ListEnrollmentsQuery = {},
): Promise<EnrollmentListResponse> {
  return apiFetch<EnrollmentListResponse>(
    `/enrollments${buildListQuery(query)}`,
    { method: "GET" },
  );
}

export function getEnrollment(id: string): Promise<EnrollmentDto> {
  return apiFetch<EnrollmentDto>(`/enrollments/${id}`, { method: "GET" });
}

export function createEnrollment(
  input: CreateEnrollmentInput,
): Promise<EnrollmentDto> {
  return apiFetch<EnrollmentDto>("/enrollments", {
    method: "POST",
    body: input,
  });
}

export function updateEnrollment(
  id: string,
  input: UpdateEnrollmentInput,
): Promise<EnrollmentDto> {
  return apiFetch<EnrollmentDto>(`/enrollments/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteEnrollment(id: string): Promise<void> {
  return apiFetch<void>(`/enrollments/${id}`, { method: "DELETE" });
}

export function bulkCreateEnrollments(
  input: BulkCreateEnrollmentInput,
): Promise<BulkEnrollmentResponse> {
  return apiFetch<BulkEnrollmentResponse>("/enrollments/bulk", {
    method: "POST",
    body: input,
  });
}
