// Typed wrappers around the Phase 2 / Slice 8 cp1 subject-attendance endpoints.
// The API routes are top-level (/subject-attendance/*) even though the UI nests
// these pages under /teacher/attendance/subject for sidebar grouping. All three
// 404 when the school hasn't enabled subjectAttendanceEnabled, and the
// register/mark/summary gate to the assigned subject teacher (owner/admin bypass)
// — the client never enforces this itself.

import type {
  SubjectAttendanceMarkInput,
  SubjectAttendanceMarkResultDto,
  SubjectAttendanceRegisterResponse,
  SubjectAttendanceSummaryResponse,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// GET /subject-attendance/register?classArmId=&subjectId=&date=&period=
export function getSubjectRegister(
  classArmId: string,
  subjectId: string,
  date: string,
  period: number,
): Promise<SubjectAttendanceRegisterResponse> {
  const params = new URLSearchParams({ classArmId, subjectId, date, period: String(period) });
  return apiFetch<SubjectAttendanceRegisterResponse>(`/subject-attendance/register?${params.toString()}`, {
    method: "GET",
  });
}

// POST /subject-attendance/mark — send only the changed rows; returns { count }.
export function markSubjectAttendance(
  classArmId: string,
  subjectId: string,
  date: string,
  period: number,
  records: SubjectAttendanceMarkInput["records"],
): Promise<SubjectAttendanceMarkResultDto> {
  return apiFetch<SubjectAttendanceMarkResultDto>("/subject-attendance/mark", {
    method: "POST",
    body: { classArmId, subjectId, date, period, records },
  });
}

// GET /subject-attendance/summary?classArmId=&subjectId=&termId=
export function getSubjectSummary(
  classArmId: string,
  subjectId: string,
  termId: string,
): Promise<SubjectAttendanceSummaryResponse> {
  const params = new URLSearchParams({ classArmId, subjectId, termId });
  return apiFetch<SubjectAttendanceSummaryResponse>(`/subject-attendance/summary?${params.toString()}`, {
    method: "GET",
  });
}
