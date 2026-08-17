import type {
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
    await apiFetch<void>("/student-portal/logout", { method: "POST" });
  } catch {
    // Intentionally swallowed — see above.
  }
}
