// Typed wrappers around the Phase 2 / Slice 7 cp1 attendance endpoints. The API
// returns each DTO directly (same shape as the other lib/<module>-api.ts files).
// Authorization is server-side: the register/summary reads + the mark write all
// gate to owner/admin OR the arm's FORM teacher (a subject teacher of the arm is
// 403'd, a stranger arm 404'd) — the client never enforces this itself.

import type {
  AttendanceMarkInput,
  AttendanceMarkResultDto,
  AttendanceRegisterResponse,
  AttendanceSummaryResponse,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// GET /attendance/register?classArmId=&date= — the day's register for one arm:
// every student enrolled by `date`, merged with whatever marks already exist
// (status null = unmarked). 400s if the date is in the future or in no term.
export function getRegister(classArmId: string, date: string): Promise<AttendanceRegisterResponse> {
  const params = new URLSearchParams({ classArmId, date });
  return apiFetch<AttendanceRegisterResponse>(`/attendance/register?${params.toString()}`, {
    method: "GET",
  });
}

// POST /attendance/mark — upsert the day's register (atomic). Send only the rows
// that changed; the API returns { count } of rows written.
export function markAttendance(
  classArmId: string,
  date: string,
  records: AttendanceMarkInput["records"],
): Promise<AttendanceMarkResultDto> {
  return apiFetch<AttendanceMarkResultDto>("/attendance/mark", {
    method: "POST",
    body: { classArmId, date, records },
  });
}

// GET /attendance/summary?classArmId=&termId= — per-student term stats + the
// arm-level rollup. Rates are Int hundredths (format with formatAverage).
export function getSummary(classArmId: string, termId: string): Promise<AttendanceSummaryResponse> {
  const params = new URLSearchParams({ classArmId, termId });
  return apiFetch<AttendanceSummaryResponse>(`/attendance/summary?${params.toString()}`, {
    method: "GET",
  });
}
