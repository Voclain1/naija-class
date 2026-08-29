import type {
  PortalInvoiceListResponse,
  StudentAttendanceResponse,
  AcceptStudentInvitationInput,
  AcceptStudentInvitationResponse,
  PublicStudentInvitationDto,
  ReleasedResultDetailDto,
  ReleasedResultListResponse,
  StudentLoginInput,
  StudentLoginResponse,
  StudentMeResponse,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Phase 6 — the student principal's API surface.
//
// A deliberate MIRROR of portal.ts, not a shared abstraction with it. A
// student is not a guardian: different credentials, different endpoints,
// different rows they are allowed to see. Collapsing the two clients would
// put a child and an adult on one code path, which is exactly what
// phase-6.md §6 refuses ("the guardian portal is a template to mirror, not a
// system to share").
//
// Note what is absent: every route below is `/student-portal/me/...`. There
// is no student-id parameter anywhere in this file, because the server does
// not accept one — the session resolves the student. That makes "could a
// student pass someone else's id?" a question with no place to be asked,
// rather than one answered correctly at each call site (phase-6.md §8).

export function studentLogin(
  input: StudentLoginInput,
): Promise<StudentLoginResponse> {
  return apiFetch<StudentLoginResponse>("/student-portal/login", {
    method: "POST",
    body: input,
  });
}

// ---- Activation (D26) ---------------------------------------------------
//
// Both routes are UNAUTHENTICATED: a child holding an invitation has no
// session yet, which is the whole reason the server resolves them through a
// SECURITY DEFINER function before any tenant context exists.
//
// Note what the lookup deliberately does NOT return: the student's name. The
// accept screen would read better as "Set a password for Adaeze", but this
// endpoint takes an attacker-supplied token, and a name would turn a leaked
// or guessed link into a disclosure of which child it belongs to. The screen
// says "your password"; the child knows who they are.

export function getStudentInvitation(
  token: string,
): Promise<PublicStudentInvitationDto> {
  return apiFetch<PublicStudentInvitationDto>(
    `/student-portal/invitations/${encodeURIComponent(token)}`,
  );
}

export function acceptStudentInvitation(
  token: string,
  input: AcceptStudentInvitationInput,
): Promise<AcceptStudentInvitationResponse> {
  return apiFetch<AcceptStudentInvitationResponse>(
    `/student-portal/invitations/${encodeURIComponent(token)}/accept`,
    { method: "POST", body: input },
  );
}

export function getStudentMe(): Promise<StudentMeResponse> {
  return apiFetch<StudentMeResponse>("/student-portal/me");
}

export function listStudentResults(): Promise<ReleasedResultListResponse> {
  return apiFetch<ReleasedResultListResponse>("/student-portal/me/results");
}

export function getStudentResult(
  termId: string,
): Promise<ReleasedResultDetailDto> {
  return apiFetch<ReleasedResultDetailDto>(
    `/student-portal/me/results/${encodeURIComponent(termId)}`,
  );
}

/**
 * Best-effort server-side session revocation.
 *
 * The caller signs out locally regardless of what this returns: a child on a
 * dead connection tapping "Sign out" on a shared handset must still have the
 * token and cache cleared from the device. Leaving them signed in because the
 * network was down would be the opposite of what the button promises.
 */
export async function studentLogout(): Promise<void> {
  try {
    await apiFetch<void>("/student-portal/logout", { method: "POST", notifyOnUnauthorized: false });
  } catch {
    // Intentionally swallowed — see above.
  }
}

/** Own attendance, per term, most recent first. No parameters — see the API. */
export function listStudentAttendance(): Promise<StudentAttendanceResponse> {
  return apiFetch<StudentAttendanceResponse>("/student-portal/me/attendance");
}

/**
 * Own invoices, read only.
 *
 * Same DTO the guardian portal returns, from the same server-side query, so a
 * child and their parent cannot be shown different figures. There is no
 * student pay endpoint to call — paying is the guardian's action.
 */
export function listStudentFees(): Promise<PortalInvoiceListResponse> {
  return apiFetch<PortalInvoiceListResponse>("/student-portal/me/fees");
}
