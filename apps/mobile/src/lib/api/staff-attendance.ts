import type {
  AttendanceMarkInput,
  AttendanceMarkResultDto,
  AttendanceRegisterResponse,
  TeacherScopeDto,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP2 teacher attendance bindings.
//
// EVERY endpoint here already exists and is in production. CP2 adds no server
// surface — no migration, no route, no permission — which is why nothing in
// this checkpoint touches `rbac-two-gate-conformance.spec.ts`. The scoping
// rules these calls are subject to (form teacher marks; subject teacher of the
// same arm → 403; arm out of scope → 404) live in AttendanceService and are
// NOT reimplemented on the client: the phone renders what the server allows.

export function staffTeacherScope(): Promise<TeacherScopeDto> {
  return apiFetch<TeacherScopeDto>("/teacher-scope/me");
}

export function staffAttendanceRegister(
  classArmId: string,
  date: string,
): Promise<AttendanceRegisterResponse> {
  const query = new URLSearchParams({ classArmId, date });
  return apiFetch<AttendanceRegisterResponse>(`/attendance/register?${query.toString()}`);
}

export function staffMarkAttendance(
  input: AttendanceMarkInput,
): Promise<AttendanceMarkResultDto> {
  // Single atomic all-or-nothing submit. There is deliberately no retry and no
  // queue here: the plan-first forbids queued staff writes, so a failure must
  // reach the screen as a failure rather than be absorbed and re-attempted
  // later against a register that may have moved on.
  return apiFetch<AttendanceMarkResultDto>("/attendance/mark", {
    method: "POST",
    body: input,
  });
}
