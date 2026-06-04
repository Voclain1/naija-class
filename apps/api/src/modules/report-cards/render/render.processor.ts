import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";

import { withTenant } from "@school-kit/db";

import { REPORT_CARDS_JOB_RENDER, REPORT_CARDS_QUEUE } from "../../../common/queue";
import { RenderService, type RenderJobData } from "./render.service";

// ---------------------------------------------------------------------------
// ReportCardRenderProcessor — the sole @Processor on REPORT_CARDS_QUEUE.
//
// concurrency: 1 is the MEMORY-BUDGET CONTROL. The BrowserPool holds a single
// Chromium; serialising jobs to one-at-a-time means we never hold two
// renderers, and the 40-card batch flows through as a queue, not a stampede.
// Do NOT raise this without re-running the memory gate — it is the knob the
// whole slice's fly.io fit depends on.
//
// One @Processor class per queue (see ImportsProcessor's note): @nestjs/bullmq
// spawns one BullMQ Worker per @Processor class. A second class on this queue
// would load-balance render jobs across competing workers.
// ---------------------------------------------------------------------------
@Processor(REPORT_CARDS_QUEUE, { concurrency: 1 })
export class ReportCardRenderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportCardRenderProcessor.name);

  constructor(private readonly render: RenderService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === REPORT_CARDS_JOB_RENDER) {
      return this.handleRender(job as Job<RenderJobData>);
    }
    throw new Error(`unknown job name on report-cards queue: ${job.name}`);
  }

  // Deliberately NOT tenantWorker: renderCard owns its OWN short transactions
  // (read+GENERATING, then GENERATED+audit) with the Chromium render BETWEEN
  // them, outside any tx — see RenderService for why. We still guard schoolId
  // here (a job missing tenancy data has no business running), mirroring the
  // imports commit handler. On any throw BullMQ retries; FAILED is written by
  // onFailed once attempts are exhausted.
  private readonly handleRender = async (job: Job<RenderJobData>): Promise<void> => {
    if (!job.data?.schoolId || !job.data?.reportCardId) {
      throw new Error(
        `render: job ${job.id ?? "(no id)"} missing schoolId/reportCardId; refusing to run`,
      );
    }
    await this.render.renderCard({
      schoolId: job.data.schoolId,
      userId: job.data.userId,
      reportCardId: job.data.reportCardId,
      attempt: job.attemptsMade + 1,
    });
  };

  // Writes ReportCard.pdfStatus = FAILED, but ONLY once BullMQ has exhausted
  // retries (or on an unrecoverable error). On a retryable mid-attempt failure
  // we leave the status as-is so a later attempt can still reach GENERATED.
  @OnWorkerEvent("failed")
  async onFailed(job: Job<RenderJobData>, error: Error): Promise<void> {
    if (!job.data?.schoolId || !job.data?.reportCardId) {
      this.logger.error(
        `render failed listener: job ${job.id} missing schoolId/reportCardId; cannot mark FAILED`,
      );
      return;
    }

    const maxAttempts = job.opts?.attempts ?? 1;
    const exhausted = job.attemptsMade >= maxAttempts;
    if (!exhausted) {
      this.logger.warn(
        `render: card ${job.data.reportCardId} attempt ${job.attemptsMade}/${maxAttempts} failed (retryable): ${error?.message}`,
      );
      return;
    }

    try {
      await withTenant(job.data.schoolId, async (db) => {
        await db.reportCard.update({
          where: { id: job.data.reportCardId },
          data: { pdfStatus: "FAILED" },
        });
      });
      this.logger.error(`render: card ${job.data.reportCardId} FAILED after ${maxAttempts} attempts: ${error?.message}`);
    } catch (writeErr) {
      this.logger.error(
        `render: could not mark card ${job.data.reportCardId} FAILED: ${
          writeErr instanceof Error ? writeErr.message : String(writeErr)
        }`,
      );
    }
  }
}
