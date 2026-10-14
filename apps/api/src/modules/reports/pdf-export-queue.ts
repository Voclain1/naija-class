import type { Queue } from "bullmq";

import { withTenant } from "@school-kit/db";
import { NotFoundError, type ReportExportStatusDto, type ReportPdfAcceptedDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { exportFilename, toPrintHtml, type ExportDocument } from "../../common/export/tabular-export.js";
import { REPORT_CARDS_JOB_EXPORT_PDF } from "../../common/queue/index.js";
import type { StorageService } from "../../common/storage/index.js";
import { loadReceiptLogo } from "../payments/receipt.js";
import type { ExportPdfJobData } from "../report-cards/render/export-pdf.service.js";
import { wakeRenderWorker } from "../report-cards/render/wake-render-worker.js";

// Phase 9 — the one path every PDF copy takes (docs/modules/phase-9.md §8.7):
// lay the page out, store it on a report_exports row with its audit row,
// queue an ids-only job for the render worker, and later hand back a
// short-lived link. Shared by the report exports (CP1.1–1.2) and the list
// exports (CP1.3) so both keep the same guarantees:
//   * the row commits before the job exists, so the worker never meets an id
//     it cannot see;
//   * a job that cannot be queued marks the row FAILED at once;
//   * the job carries ids only — the rows never pass through Redis.
// A plain class, not a Nest provider: each owner builds it from the storage
// and queue it already holds.

/** Signed-link lifetime for a finished PDF, as for receipts. */
const PDF_URL_TTL_SECONDS = 15 * 60;

export interface PdfAuditFields {
  /** Written to the audit row's action, e.g. "reports.export". */
  action: string;
  /** Extra metadata beside format and row count, e.g. { report: "academic" }. */
  metadata: Record<string, string | number | null>;
}

export class PdfExportQueue {
  constructor(
    private readonly storage: StorageService,
    private readonly queue: Queue,
    private readonly todayFn: () => string,
  ) {}

  async queuePdf(
    authCtx: AuthContext,
    report: string,
    doc: ExportDocument,
    termId: string | null,
    audit: PdfAuditFields,
    ipAddress: string | null,
  ): Promise<ReportPdfAcceptedDto> {
    const logoUrl = await withTenant(authCtx.schoolId, async (db) =>
      (await db.school.findUnique({ where: { id: authCtx.schoolId }, select: { logoUrl: true } }))?.logoUrl ?? null,
    );
    const logoDataUri = await loadReceiptLogo(this.storage, authCtx.schoolId, logoUrl);
    const html = toPrintHtml(doc, { logoDataUri, printedOn: this.todayFn() });
    const filename = exportFilename(doc.title, doc.subtitle, "pdf");
    const rows = doc.tables.reduce((n, t) => n + t.rows.length, 0);

    const exportId = await withTenant(authCtx.schoolId, async (db) => {
      const row = await db.reportExport.create({
        data: { schoolId: authCtx.schoolId, requestedBy: authCtx.userId, report, termId, filename, html },
        select: { id: true },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: audit.action,
          entityType: "report_export",
          entityId: row.id,
          ipAddress,
          metadata: { ...audit.metadata, format: "pdf", rows },
        },
      });
      return row.id;
    });

    try {
      const data: ExportPdfJobData = { schoolId: authCtx.schoolId, userId: authCtx.userId, exportId };
      await this.queue.add(REPORT_CARDS_JOB_EXPORT_PDF, data);
    } catch (err) {
      // No job means nothing will ever finish this row; say so now rather
      // than leave the page waiting.
      await withTenant(authCtx.schoolId, (db) =>
        db.reportExport.update({ where: { id: exportId }, data: { status: "FAILED", html: null, finishedAt: new Date() } }),
      );
      throw err;
    }
    wakeRenderWorker("report export");
    return { exportId };
  }

  /**
   * The export's status and, once made, a short-lived link. RLS bounds the
   * read to the caller's school; `onlyRequestedBy` narrows it further to one
   * person's own exports (another person's id reads as not found).
   */
  async status(authCtx: AuthContext, exportId: string, onlyRequestedBy?: string): Promise<ReportExportStatusDto> {
    const row = await withTenant(authCtx.schoolId, (db) =>
      db.reportExport.findFirst({
        where: { id: exportId, ...(onlyRequestedBy ? { requestedBy: onlyRequestedBy } : {}) },
        select: { id: true, status: true, filename: true },
      }),
    );
    if (!row) throw new NotFoundError("Export not found.");
    const url =
      row.status === "GENERATED"
        ? await this.storage.signUrl(authCtx.schoolId, { kind: "report-export", exportId: row.id }, PDF_URL_TTL_SECONDS)
        : null;
    return { exportId: row.id, status: row.status, filename: row.filename, url };
  }
}

export async function schoolNameOf(schoolId: string): Promise<string> {
  const school = await withTenant(schoolId, (db) => db.school.findUnique({ where: { id: schoolId }, select: { name: true } }));
  return school?.name ?? "";
}
