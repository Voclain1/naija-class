import type {
  CreateAndLinkGuardianInput,
  CreateEnrollmentInput,
  CreateStudentGuardianLinkResponse,
  EnrollmentDto,
  GuardianDetailDto,
  GuardianDto,
  GuardianListResponse,
  InviteGuardianResponse,
  LinkExistingGuardianInput,
  MoveEnrollmentInput,
  MoveEnrollmentResultDto,
  ResendGuardianInviteResponse,
  RevokeGuardianInviteResponse,
  UpdateGuardianInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP9a — parents, and class placement, for owners and admins.
//
// GuardiansService and EnrollmentsService both check the owner/admin ROLE on
// top of the controllers' permissions, so the screens behind these are offered
// on isSchoolAdmin + the permission (guardian-form.ts), never the permission
// alone.
//
// A guardian record carries a parent's phone, email and address. Same rule as
// the student bindings: every key starts with "staff" and is never persisted.

export function staffSearchGuardians(search: string): Promise<GuardianListResponse> {
  const params = new URLSearchParams({ search, limit: "20" });
  return apiFetch<GuardianListResponse>(`/guardians?${params.toString()}`);
}

export function staffGetGuardian(id: string): Promise<GuardianDetailDto> {
  return apiFetch<GuardianDetailDto>(`/guardians/${encodeURIComponent(id)}`);
}

export function staffUpdateGuardian(id: string, input: UpdateGuardianInput): Promise<GuardianDto> {
  return apiFetch<GuardianDto>(`/guardians/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export function staffLinkGuardian(
  studentId: string,
  input: LinkExistingGuardianInput,
): Promise<CreateStudentGuardianLinkResponse> {
  return apiFetch<CreateStudentGuardianLinkResponse>(
    `/students/${encodeURIComponent(studentId)}/guardians`,
    { method: "POST", body: input },
  );
}

export function staffCreateAndLinkGuardian(
  studentId: string,
  input: CreateAndLinkGuardianInput,
): Promise<CreateStudentGuardianLinkResponse> {
  return apiFetch<CreateStudentGuardianLinkResponse>(
    `/students/${encodeURIComponent(studentId)}/guardians/new`,
    { method: "POST", body: input },
  );
}

export function staffInviteGuardian(id: string): Promise<InviteGuardianResponse> {
  return apiFetch<InviteGuardianResponse>(`/guardians/${encodeURIComponent(id)}/invite`, { method: "POST" });
}

export function staffResendGuardianInvite(id: string): Promise<ResendGuardianInviteResponse> {
  return apiFetch<ResendGuardianInviteResponse>(`/guardians/${encodeURIComponent(id)}/invite/resend`, {
    method: "POST",
  });
}

export function staffRevokeGuardianInvite(id: string): Promise<RevokeGuardianInviteResponse> {
  return apiFetch<RevokeGuardianInviteResponse>(`/guardians/${encodeURIComponent(id)}/invite/revoke`, {
    method: "POST",
  });
}

/** Place a student in a class for a term (POST /enrollments). */
export function staffEnrollStudent(input: CreateEnrollmentInput): Promise<EnrollmentDto> {
  return apiFetch<EnrollmentDto>("/enrollments", { method: "POST", body: input });
}

/**
 * Move a placed child to another class, same term (D39). The server answers
 * 409 MOVE_NEEDS_PASSWORD (with what would change) when the child already has
 * records, and 403 PASSWORD_INCORRECT for a wrong password — never 401, so a
 * typo cannot sign the admin out.
 */
export function staffMoveEnrollment(enrollmentId: string, input: MoveEnrollmentInput): Promise<MoveEnrollmentResultDto> {
  return apiFetch<MoveEnrollmentResultDto>(`/enrollments/${encodeURIComponent(enrollmentId)}/move`, {
    method: "POST",
    body: input,
  });
}
