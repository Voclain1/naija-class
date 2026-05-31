// Typed wrappers around the slice 11 cp2 teacher-scope endpoints. These are
// the ONLY API the teacher portal pages call — they are scope-filtered
// server-side (a teacher sees only their assigned + homeroom arms), so the
// client never has to enforce authorization itself.
//
//   GET /teacher-scope/me                          → arms + subjects-by-arm
//   GET /teacher-scope/me/arms/:armId/students     → one arm's roster
//
// getMyArmRoster throws ApiError 404 when the arm is out of scope (or in
// another tenant) — the portal's [armId] page treats that as "not one of
// your classes", matching the server's deliberate 404-not-403 semantics.

import type {
  TeacherRosterResponse,
  TeacherScopeDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getMyScope(): Promise<TeacherScopeDto> {
  return apiFetch<TeacherScopeDto>("/teacher-scope/me", { method: "GET" });
}

export function getMyArmRoster(armId: string): Promise<TeacherRosterResponse> {
  return apiFetch<TeacherRosterResponse>(
    `/teacher-scope/me/arms/${armId}/students`,
    { method: "GET" },
  );
}
