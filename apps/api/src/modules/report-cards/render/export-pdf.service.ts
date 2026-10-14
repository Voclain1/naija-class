import { Injectable, Logger } from "@nestjs/common";

import { withTenant } from "@school-kit/db";

import { StorageService } from "../../../common/storage";
import { BrowserPool } from "./browser-pool";

// The data of a REPORT_CARDS_JOB_EXPORT_PDF job: ids only. The report's rows
// travel in the report_exports row, never through Redis.
export interface ExportPdfJobData {
  schoolId: string;
  userId: string;
  exportId: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// ExportPdfService (Phase 9 / CP1.1) — prints a report the API has already laid
// out (docs/modules/phase-9.md §8 CP1-D3). The worker knows nothing about
// reports: it reads the HTML from report_exports, prints it, stores the PDF
// and clears the HTML, so the report's rows stay in the table only for the
// seconds between the API writing them and this job running.
//
// Same three-step shape as RenderService, for the same reason: Chromium runs
// OUTSIDE any transaction.
//   1. SHORT tx: read the row; skip one that is gone or already finished.
//   2. NO tx:   print in the pooled page, store the file.
//   3. SHORT tx: GENERATED + storage path + finishedAt, html cleared.
// FAILED is written by the processor's failed listener once retries run out.
// ---------------------------------------------------------------------------
@Injectable()
export class ExportPdfService {
  private readonly logger = new Logger(ExportPdfService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly browserPool: BrowserPool,
  ) {}

  async renderExport(job: ExportPdfJobData): Promise<void> {
    const { schoolId, exportId } = job;
    const row = await withTenant(schoolId, (db) =>
      db.reportExport.findUnique({ where: { id: exportId }, select: { status: true, html: true } }),
    );
    // Deleted by the clean-up, or finished by an earlier attempt: nothing to do,
    // and throwing would only make BullMQ retry a job that cannot succeed.
    if (!row || row.status !== "PENDING" || row.html === null) {
      this.logger.warn(`export-pdf: export ${exportId} is gone or already finished; skipping`);
      return;
    }
    const html = row.html;

    const pdf = await this.browserPool.withPage(async (page) => {
      await page.setContent(html, { waitUntil: "load" });
      const buffer = await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        margin: { top: "12mm", bottom: "14mm", left: "10mm", right: "10mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="font-size:8px;width:100%;text-align:center;color:#4a5a60">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      });
      return Buffer.from(buffer);
    });

    const path = await this.storage.put(schoolId, { kind: "report-export", exportId }, pdf, "application/pdf");

    await withTenant(schoolId, (db) =>
      db.reportExport.update({
        where: { id: exportId },
        data: { status: "GENERATED", storagePath: path, html: null, finishedAt: new Date() },
      }),
    );
    this.logger.log(`export-pdf: export ${exportId} GENERATED — ${pdf.length} bytes`);
  }

  async markFailed(job: ExportPdfJobData): Promise<void> {
    await withTenant(job.schoolId, (db) =>
      db.reportExport.updateMany({
        where: { id: job.exportId, status: "PENDING" },
        data: { status: "FAILED", html: null, finishedAt: new Date() },
      }),
    );
  }
}
