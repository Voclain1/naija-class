import type {
  AcademicReportDto,
  AnalyticsExportReport,
  AttendanceReportDto,
  EnrolmentReportDto,
  ReportExportStatusDto,
  ReportPdfAcceptedDto,
  TeacherActivityReportDto,
} from "@school-kit/types";

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

// Phase 9 / CP1.3b — the analytics tabs as phone summaries (docs/modules/phase-9.md
// §8.3). Owner/admin only; the screens check reports.analytics.read first.
// Not audited per read (unlike the teacher view above), so these refetch as
// any staff query does.


const termQuery = (termId?: string) => (termId ? `?${new URLSearchParams({ termId }).toString()}` : "");

export const staffAcademicReport = (termId?: string) => apiFetch<AcademicReportDto>(`/reports/academic${termQuery(termId)}`);
export const staffAttendanceReport = (termId?: string) =>
  apiFetch<AttendanceReportDto>(`/reports/attendance${termQuery(termId)}`);
export const staffEnrolmentReport = (termId?: string) =>
  apiFetch<EnrolmentReportDto>(`/reports/enrolment${termQuery(termId)}`);

/** The path of a whole tab as an Excel workbook (downloaded natively, with the bearer header). */
export function analyticsExcelPath(report: AnalyticsExportReport, termId?: string): string {
  const qs = new URLSearchParams({ format: "xlsx" });
  if (termId) qs.set("termId", termId);
  return `/reports/analytics/${report}/export?${qs.toString()}`;
}

export function staffRequestAnalyticsPdf(report: AnalyticsExportReport, termId?: string): Promise<ReportPdfAcceptedDto> {
  return apiFetch<ReportPdfAcceptedDto>(`/reports/analytics/${report}/pdf`, { method: "POST", body: { termId } });
}

export function staffReportExport(exportId: string): Promise<ReportExportStatusDto> {
  return apiFetch<ReportExportStatusDto>(`/reports/exports/${encodeURIComponent(exportId)}`);
}
