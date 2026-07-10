// Typed wrappers for the staff UI (slice 10 cp3). Staff are Users with the
// teacher/admin/owner role; their HR record is a TeacherProfile. The roster
// composes three server endpoints (none of which changed in cp3 — this is a
// pure-web slice):
//
//   - GET  /users               → accepted staff (User rows) + their roles
//   - GET  /users/invitations   → pending (unaccepted, unexpired) invitations
//   - GET  /teacher-profiles     → which users have an HR profile
//
// The single-invite + teacher-profile CRUD wrappers live here too. Shapes
// come from @school-kit/types so the client can't drift from the server
// contract.
//
// Note on `inviteStaff`: POST /users/invite accepts roleKey "admin" | "bursar"
// (Phase 3 slice 15). Teachers are still invited in bulk via the CSV import
// wizard (which mints roleKey="teacher" invitations) — a single teacher
// invite remains a separate, still-open deferred.md item.

import type {
  CreateTeacherAssignmentInput,
  CreateTeacherProfileInput,
  InviteAdminInput,
  InviteAdminResponse,
  ListTeacherAssignmentsQuery,
  ListTeacherProfilesQuery,
  PendingInvitationDto,
  TeacherAssignmentDto,
  TeacherAssignmentListResponse,
  TeacherProfileDto,
  TeacherProfileListResponse,
  UpdateMyTeacherProfileInput,
  UpdateTeacherProfileInput,
  UserListItemDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Re-export the teacher CSV upload under the plan's name so the staff
// import wizard + any staff-centric caller has one obvious home. The
// implementation lives in lib/imports/api.ts next to its student/guardian
// siblings.
export { uploadTeachersCsv as uploadTeachersImportCsv } from "../imports/api";

// ---- Staff roster (accepted users + pending invitations) ----------------

// GET /users — accepted staff (active + inactive), excluding the caller.
// Not cursor-paginated server-side (returns the full set); fine at pilot
// scale. The roster page renders all of them.
export function listStaff(): Promise<UserListItemDto[]> {
  return apiFetch<UserListItemDto[]>("/users", { method: "GET" });
}

// GET /users/invitations — pending (unaccepted, unexpired) invitations.
export function listStaffInvitations(): Promise<PendingInvitationDto[]> {
  return apiFetch<PendingInvitationDto[]>("/users/invitations", {
    method: "GET",
  });
}

// POST /users/invite — creates an admin or bursar invitation per
// input.roleKey. Returns the raw accept URL once; it's not recoverable
// afterwards.
export function inviteStaff(
  input: InviteAdminInput,
): Promise<InviteAdminResponse> {
  return apiFetch<InviteAdminResponse>("/users/invite", {
    method: "POST",
    body: input,
  });
}

// ---- Teacher profiles (admin CRUD) --------------------------------------

function buildTeacherProfilesQuery(query: ListTeacherProfilesQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.specialty) params.set("specialty", query.specialty);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listTeacherProfiles(
  query: ListTeacherProfilesQuery = {},
): Promise<TeacherProfileListResponse> {
  return apiFetch<TeacherProfileListResponse>(
    `/teacher-profiles${buildTeacherProfilesQuery(query)}`,
    { method: "GET" },
  );
}

export function getTeacherProfile(id: string): Promise<TeacherProfileDto> {
  return apiFetch<TeacherProfileDto>(`/teacher-profiles/${id}`, {
    method: "GET",
  });
}

export function createTeacherProfile(
  input: CreateTeacherProfileInput,
): Promise<TeacherProfileDto> {
  return apiFetch<TeacherProfileDto>("/teacher-profiles", {
    method: "POST",
    body: input,
  });
}

export function updateTeacherProfile(
  id: string,
  input: UpdateTeacherProfileInput,
): Promise<TeacherProfileDto> {
  return apiFetch<TeacherProfileDto>(`/teacher-profiles/${id}`, {
    method: "PATCH",
    body: input,
  });
}

// ---- Teacher profile (self-service /me) ---------------------------------

export function getMyTeacherProfile(): Promise<TeacherProfileDto> {
  return apiFetch<TeacherProfileDto>("/teacher-profiles/me", { method: "GET" });
}

// PATCH /teacher-profiles/me — the API's .strict() schema accepts ONLY
// specialty + qualifications. staffNumber + nutNumber are admin-only and
// rejected with a 400 (see update-my-teacher-profile.dto.ts).
export function updateMyTeacherProfile(
  input: UpdateMyTeacherProfileInput,
): Promise<TeacherProfileDto> {
  return apiFetch<TeacherProfileDto>("/teacher-profiles/me", {
    method: "PATCH",
    body: input,
  });
}

// ---- Teacher assignments (slice 11 cp1 admin CRUD) ----------------------
//
// Powers the "Teaching assignments" section on /staff/[userId]. The list is
// filtered by teacherId; create + delete are the admin's assign / unassign
// actions. Delete is a HARD delete (cp1's DELETE /teacher-assignments/:id —
// history lives in audit_logs), so removed rows simply disappear.

export function listTeacherAssignments(
  query: ListTeacherAssignmentsQuery = {},
): Promise<TeacherAssignmentListResponse> {
  const params = new URLSearchParams();
  if (query.teacherId) params.set("teacherId", query.teacherId);
  if (query.classArmId) params.set("classArmId", query.classArmId);
  if (query.academicYearId) params.set("academicYearId", query.academicYearId);
  if (query.subjectId) params.set("subjectId", query.subjectId);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return apiFetch<TeacherAssignmentListResponse>(
    `/teacher-assignments${qs ? `?${qs}` : ""}`,
    { method: "GET" },
  );
}

export function createTeacherAssignment(
  input: CreateTeacherAssignmentInput,
): Promise<TeacherAssignmentDto> {
  return apiFetch<TeacherAssignmentDto>("/teacher-assignments", {
    method: "POST",
    body: input,
  });
}

export function deleteTeacherAssignment(id: string): Promise<void> {
  return apiFetch<void>(`/teacher-assignments/${id}`, { method: "DELETE" });
}
