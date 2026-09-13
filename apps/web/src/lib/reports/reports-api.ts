// Typed wrapper around /reports (Phase 8 / CP2). Shapes come from
// @school-kit/types so the client cannot drift from the API.

import type { CompletenessReportDto, TeacherActivityReportDto } from "@school-kit/types";

import { apiFetch } from "../api-client";

const q = (termId?: string) => (termId ? `?termId=${encodeURIComponent(termId)}` : "");

export function getCompletenessReport(termId?: string): Promise<CompletenessReportDto> {
  return apiFetch<CompletenessReportDto>(`/reports/completeness${q(termId)}`);
}

/** Audited server-side on every call (§3.4 D23) — call only when the view is actually opened. */
export function getTeacherActivityReport(termId?: string): Promise<TeacherActivityReportDto> {
  return apiFetch<TeacherActivityReportDto>(`/reports/teacher-activity${q(termId)}`);
}

/** "12 of 61" — counts always travel with their denominator (§16 D33). */
export function ofCount(done: number, expected: number): string {
  return `${done} of ${expected}`;
}
