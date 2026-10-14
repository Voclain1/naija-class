import type { ReportExportStatusDto } from "@school-kit/types";

// Phase 9 / CP1.3b — waiting for a report PDF the render worker is making.
// Pure (the fetcher and the pause are parameters) so it is tested without a
// device. The worker may be asleep and take ~20 s to wake, so the wait is
// generous; past it the last PENDING status is returned and the screen says
// the PDF is still being made.

export const PDF_POLL_INTERVAL_MS = 2_000;
export const PDF_WAIT_LIMIT_MS = 120_000;

export async function waitForReportPdf(
  exportId: string,
  fetchStatus: (id: string) => Promise<ReportExportStatusDto>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  intervalMs = PDF_POLL_INTERVAL_MS,
  limitMs = PDF_WAIT_LIMIT_MS,
): Promise<ReportExportStatusDto> {
  let waited = 0;
  for (;;) {
    const status = await fetchStatus(exportId);
    if (status.status !== "PENDING" || waited >= limitMs) return status;
    await sleep(intervalMs);
    waited += intervalMs;
  }
}

/** "academic", "First Term", "2026/2027", "xlsx" → "academic-report-first-term-2026-2027.xlsx". */
export function reportFileName(report: string, termName: string | null, yearLabel: string | null, ext: string): string {
  const slug = [report, "report", termName ?? "", yearLabel ?? ""]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}.${ext}`;
}
