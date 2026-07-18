// Typed wrappers around the Phase 1 / Slice 5 guardians endpoints.
//
// Two route prefixes live behind these wrappers (mirrors the controller):
//   - /guardians/*            — flat guardian CRUD
//   - /students/:id/guardians — nested link create (existing + /new)
//   - /student-guardians/:id  — flat link PATCH/DELETE
// All endpoints are admin/owner-gated server-side.

import type {
  CreateAndLinkGuardianInput,
  CreateGuardianInput,
  CreateStudentGuardianLinkResponse,
  GuardianDetailDto,
  GuardianDto,
  GuardianListResponse,
  InviteGuardianResponse,
  LinkExistingGuardianInput,
  ListGuardiansQuery,
  UpdateGuardianInput,
  UpdateStudentGuardianLinkInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

function buildListQuery(query: ListGuardiansQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.studentId) params.set("studentId", query.studentId);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listGuardians(
  query: ListGuardiansQuery = {},
): Promise<GuardianListResponse> {
  return apiFetch<GuardianListResponse>(`/guardians${buildListQuery(query)}`, {
    method: "GET",
  });
}

export function getGuardian(id: string): Promise<GuardianDetailDto> {
  return apiFetch<GuardianDetailDto>(`/guardians/${id}`, { method: "GET" });
}

export function createGuardian(
  input: CreateGuardianInput,
): Promise<GuardianDto> {
  return apiFetch<GuardianDto>(`/guardians`, { method: "POST", body: input });
}

export function updateGuardian(
  id: string,
  input: UpdateGuardianInput,
): Promise<GuardianDto> {
  return apiFetch<GuardianDto>(`/guardians/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteGuardian(id: string): Promise<void> {
  return apiFetch<void>(`/guardians/${id}`, { method: "DELETE" });
}

// POST /guardians/:id/invite — sends a portal invitation. owner/admin only
// server-side (guardian.invite); no request body. Throws ApiError with
// code GUARDIAN_HAS_NO_EMAIL (400) or INVITATION_ALREADY_PENDING (409).
export function inviteGuardian(id: string): Promise<InviteGuardianResponse> {
  return apiFetch<InviteGuardianResponse>(`/guardians/${id}/invite`, {
    method: "POST",
  });
}

// Link an existing guardian to a student.
export function linkExistingGuardian(
  studentId: string,
  input: LinkExistingGuardianInput,
): Promise<CreateStudentGuardianLinkResponse> {
  return apiFetch<CreateStudentGuardianLinkResponse>(
    `/students/${studentId}/guardians`,
    { method: "POST", body: input },
  );
}

// Create a new guardian and link it to the student in one transaction.
export function createAndLinkGuardian(
  studentId: string,
  input: CreateAndLinkGuardianInput,
): Promise<CreateStudentGuardianLinkResponse> {
  return apiFetch<CreateStudentGuardianLinkResponse>(
    `/students/${studentId}/guardians/new`,
    { method: "POST", body: input },
  );
}

// PATCH a StudentGuardian link — toggle isPrimary / canPickup.
export function updateStudentGuardianLink(
  linkId: string,
  input: UpdateStudentGuardianLinkInput,
): Promise<CreateStudentGuardianLinkResponse> {
  return apiFetch<CreateStudentGuardianLinkResponse>(
    `/student-guardians/${linkId}`,
    { method: "PATCH", body: input },
  );
}

// Unlink a guardian from a student. The Guardian row is preserved.
export function unlinkStudentGuardian(linkId: string): Promise<void> {
  return apiFetch<void>(`/student-guardians/${linkId}`, { method: "DELETE" });
}
