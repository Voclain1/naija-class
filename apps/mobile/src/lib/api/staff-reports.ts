import type { TeacherActivityReportDto } from "@school-kit/types";

import { apiFetch } from "./client";

// CP4d — the per-teacher activity report.
//
// D35: EVERY call to this endpoint writes an audit row (§16 D23) — it is a
// per-person view of named colleagues. So it is fetched ONLY when the screen
// that shows it is opened, never on the dashboard, never in the background,
// and never refetched just because the app came back to the foreground. The
// query that uses it pins that down (staleTime Infinity, no refetch on focus
// or reconnect); this binding only has to make the one request.
//
// The whole-school completeness report lives in staff-approvals.ts, because
// the approvals screen reads it too.

/** `termId` omitted → the school's current term (the endpoint's default). */
export function staffTeacherActivity(termId?: string): Promise<TeacherActivityReportDto> {
  const query = termId ? `?${new URLSearchParams({ termId }).toString()}` : "";
  return apiFetch<TeacherActivityReportDto>(`/reports/teacher-activity${query}`);
}
