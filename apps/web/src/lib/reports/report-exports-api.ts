// Excel and PDF copies of the reports (Phase 9 / CP1.1, docs/modules/phase-9.md §8).
//
// Excel comes back at once. A PDF is queued: the API answers with an export
// id, and waitForPdf polls until the render worker has made it. The worker
// may be asleep and take ~20 s to wake, so the wait is generous.

import type {
  CompletenessExportSection,
  ReportExportStatusDto,
  ReportPdfAcceptedDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";
import { downloadApiFile } from "../file-download";

const params = (entries: Record<string, string | undefined>): string => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(entries)) if (v) qs.set(k, v);
  return qs.toString();
};

export function downloadCompletenessExcel(section: CompletenessExportSection, termId?: string): Promise<void> {
  return downloadApiFile(
    `/reports/completeness/export?${params({ section, termId, format: "xlsx" })}`,
    `${section === "registers" ? "registers" : "score-entry"}.xlsx`,
  );
}

export function downloadTeacherActivityExcel(termId?: string): Promise<void> {
  return downloadApiFile(`/reports/teacher-activity/export?${params({ termId, format: "xlsx" })}`, "teacher-activity.xlsx");
}

export function requestCompletenessPdf(section: CompletenessExportSection, termId?: string): Promise<ReportPdfAcceptedDto> {
  return apiFetch<ReportPdfAcceptedDto>("/reports/completeness/pdf", { method: "POST", body: { section, termId } });
}

export function requestTeacherActivityPdf(termId?: string): Promise<ReportPdfAcceptedDto> {
  return apiFetch<ReportPdfAcceptedDto>("/reports/teacher-activity/pdf", { method: "POST", body: { termId } });
}

export function getReportExport(exportId: string): Promise<ReportExportStatusDto> {
  return apiFetch<ReportExportStatusDto>(`/reports/exports/${encodeURIComponent(exportId)}`);
}

export const PDF_POLL_INTERVAL_MS = 2_000;
export const PDF_WAIT_LIMIT_MS = 120_000;

/**
 * Polls until the PDF is GENERATED or FAILED, or the wait runs out (then the
 * last PENDING status is returned, and the caller says it is still being
 * made). `fetchStatus` and `sleep` are parameters so the loop is testable.
 */
export async function waitForPdf(
  exportId: string,
  {
    fetchStatus = getReportExport,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    intervalMs = PDF_POLL_INTERVAL_MS,
    limitMs = PDF_WAIT_LIMIT_MS,
  }: {
    fetchStatus?: (id: string) => Promise<ReportExportStatusDto>;
    sleep?: (ms: number) => Promise<void>;
    intervalMs?: number;
    limitMs?: number;
  } = {},
): Promise<ReportExportStatusDto> {
  let waited = 0;
  for (;;) {
    const status = await fetchStatus(exportId);
    if (status.status !== "PENDING" || waited >= limitMs) return status;
    await sleep(intervalMs);
    waited += intervalMs;
  }
}
