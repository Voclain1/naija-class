// Typed wrappers for the Phase 9 / CP1.2 analytics tabs (docs/modules/phase-9.md §8).
// Shapes come from @school-kit/types so the page cannot drift from the API.

import type {
  AcademicReportDto,
  AnalyticsExportReport,
  AttendanceReportDto,
  EnrolmentReportDto,
  ReportPdfAcceptedDto,
  TeacherTrendReportDto,
} from "@school-kit/types";
import { formatHundredths } from "@school-kit/types";

import { apiFetch } from "../api-client";
import { downloadApiFile } from "../file-download";

const q = (termId?: string, extra: Record<string, string> = {}) => {
  const qs = new URLSearchParams(extra);
  if (termId) qs.set("termId", termId);
  const s = qs.toString();
  return s ? `?${s}` : "";
};

export const getAcademicReport = (termId?: string) => apiFetch<AcademicReportDto>(`/reports/academic${q(termId)}`);
export const getAttendanceReport = (termId?: string) => apiFetch<AttendanceReportDto>(`/reports/attendance${q(termId)}`);
export const getEnrolmentReport = (termId?: string) => apiFetch<EnrolmentReportDto>(`/reports/enrolment${q(termId)}`);
/** Audited server-side (it names colleagues' work) — call only when someone asks to see it. */
export const getTeacherTrendReport = (termId?: string) => apiFetch<TeacherTrendReportDto>(`/reports/teacher-trend${q(termId)}`);

export function downloadAnalyticsExcel(report: AnalyticsExportReport, termId?: string): Promise<void> {
  return downloadApiFile(`/reports/analytics/${report}/export${q(termId, { format: "xlsx" })}`, `${report}-report.xlsx`);
}

export function requestAnalyticsPdf(report: AnalyticsExportReport, termId?: string): Promise<ReportPdfAcceptedDto> {
  return apiFetch<ReportPdfAcceptedDto>(`/reports/analytics/${report}/pdf`, { method: "POST", body: { termId } });
}

export function downloadTeacherTrendExcel(termId?: string): Promise<void> {
  return downloadApiFile(`/reports/teacher-trend/export${q(termId, { format: "xlsx" })}`, "teacher-recording-trend.xlsx");
}

export function requestTeacherTrendPdf(termId?: string): Promise<ReportPdfAcceptedDto> {
  return apiFetch<ReportPdfAcceptedDto>("/reports/teacher-trend/pdf", { method: "POST", body: { termId } });
}

/** 9333 → "93.33%"; null → "—". */
export function percent(hundredths: number | null): string {
  return hundredths === null ? "—" : `${formatHundredths(hundredths)}%`;
}

/** +1000 → "up 10.00", −250 → "down 2.50", 0 → "no change", null → "—". Words, not just colour. */
export function changeWords(hundredths: number | null): string {
  if (hundredths === null) return "—";
  if (hundredths === 0) return "no change";
  return `${hundredths > 0 ? "up" : "down"} ${formatHundredths(Math.abs(hundredths))}`;
}

export type ScoreBand = "high" | "middle" | "low";

/** The heatmap's three shades: 70 and above, 50 to under 70, under 50. */
export function scoreBand(hundredths: number): ScoreBand {
  if (hundredths >= 7000) return "high";
  if (hundredths >= 5000) return "middle";
  return "low";
}
