import { Injectable, Logger } from "@nestjs/common";

import { withTenant } from "@school-kit/db";

import { StorageService } from "../../../common/storage";
import { ReportCardService } from "../report-card.service";
import { BrowserPool } from "./browser-pool";
import { renderReportCardHtml } from "./report-card-template";

// The shape of a REPORT_CARDS_JOB_RENDER job's data. schoolId + userId are the
// tenancy/actor pair tenantWorker requires; reportCardId is the single card
// this job renders.
export interface RenderJobData {
  schoolId: string;
  userId: string;
  reportCardId: string;
  [k: string]: unknown;
}

export interface RenderParams {
  schoolId: string;
  userId: string;
  reportCardId: string;
  attempt: number;
}

// ---------------------------------------------------------------------------
// RenderService (Phase 2 / Slice 5 cp2) — turns ONE frozen ReportCard into a
// PDF and stores it.
//
// CRITICAL: the Chromium render runs OUTSIDE any DB transaction. Like the
// imports COMMIT handler (and unlike the imports VALIDATE handler), this is
// deliberately NOT a tenantWorker. A headless-Chrome render can take seconds
// and is capped at a 30s hard timeout; holding a Postgres interactive
// transaction open across it would pin a connection and blow Prisma's 5s
// interactive-transaction timeout. So renderCard owns its OWN transactions:
//
//   1. SHORT tx: read the frozen render data + flip pdfStatus → GENERATING.
//   2. NO tx:   render the PDF (pooled browser) + store to R2/filesystem.
//   3. SHORT tx: flip pdfStatus → GENERATED, set artifactUrl/generatedAt, audit.
//
// pdfStatus lifecycle: PENDING (at enqueue) → GENERATING → GENERATED | FAILED
// (FAILED written by the processor's failed-event listener on retry
// exhaustion). artifactUrl holds the storage PATH (not a signed URL — URLs are
// minted on demand by ReportCardService.getPdfUrl with a short TTL).
//
// PII boundary: this is a system job. No student PII leaves the box — the only
// outbound write is the PDF to our own tenant-scoped storage. Nothing here
// calls an LLM or any third party with student data.
// ---------------------------------------------------------------------------
@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);

  constructor(
    private readonly reportCards: ReportCardService,
    private readonly storage: StorageService,
    private readonly browserPool: BrowserPool,
  ) {}

  async renderCard(params: RenderParams): Promise<void> {
    const startedAt = Date.now();
    const { schoolId, userId, reportCardId, attempt } = params;

    // Phase 1 — SHORT tx: the storage key needs the (termId, studentId) pair;
    // assemble the template data from the FROZEN rollup; flip to GENERATING. A
    // missing row means the card was deleted between enqueue and render —
    // idempotent skip (don't throw, or BullMQ retries a card that's gone).
    const prep = await withTenant(schoolId, async (db) => {
      const card = await db.reportCard.findUnique({
        where: { id: reportCardId },
        select: { studentId: true, termId: true },
      });
      if (!card) return null;
      const data = await this.reportCards.getRenderData(db, reportCardId);
      if (!data) return null;
      await db.reportCard.update({ where: { id: reportCardId }, data: { pdfStatus: "GENERATING" } });
      return { card, data };
    });
    if (!prep) {
      this.logger.warn(`render: report card ${reportCardId} no longer exists; skipping`);
      return;
    }

    const html = renderReportCardHtml(prep.data);

    // Phase 2 — NO tx: render to PDF in a pooled, recycled, hard-timeout-bounded
    // page, then store. We feed our own HTML via setContent (no remote
    // navigation); "load" fires after the optional logo image finishes loading.
    const pdf = await this.browserPool.withPage(async (page) => {
      await page.setContent(html, { waitUntil: "load" });
      const buffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
      });
      return Buffer.from(buffer);
    });

    // Deterministic path (schools/<schoolId>/report-cards/<termId>/<studentId>.pdf)
    // → a re-render OVERWRITES in place: idempotent, no orphaned blobs on retry.
    const path = await this.storage.put(
      schoolId,
      { kind: "report-card", termId: prep.card.termId, studentId: prep.card.studentId },
      pdf,
      "application/pdf",
    );

    // Phase 3 — SHORT tx: mark GENERATED + audit.
    const durationMs = Date.now() - startedAt;
    await withTenant(schoolId, async (db) => {
      await db.reportCard.update({
        where: { id: reportCardId },
        data: { pdfStatus: "GENERATED", artifactUrl: path, generatedAt: new Date() },
      });
      await db.auditLog.create({
        data: {
          schoolId,
          userId,
          action: "report-card.render",
          entityType: "report_card",
          entityId: reportCardId,
          ipAddress: null,
          metadata: { reportCardId, pdfStatus: "GENERATED", attempt, durationMs, bytes: pdf.length },
        },
      });
    });

    this.logger.log(
      `render: report card ${reportCardId} GENERATED — ${pdf.length} bytes in ${durationMs}ms (attempt ${attempt})`,
    );
  }
}
