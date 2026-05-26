import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";

import {
  IMPORTS_JOB_VALIDATE,
  IMPORTS_QUEUE,
  tenantWorker,
} from "../../../common/queue";
import type { ValidateJobData } from "../imports.service";

// cp2 STUB validate processor. The real worker arrives in cp3 and will:
//   - load the ImportJob row,
//   - stream the source CSV from storage,
//   - apply columnMapping + studentImportRowSchema row-by-row,
//   - run in-file dedup + external dedup,
//   - build previewSnapshot,
//   - flip status to READY (or FAILED with failedReason).
//
// cp2's stub exists ONLY to verify the enqueue path works end-to-end —
// the mapping endpoint returns 202 VALIDATING and the wizard polls
// GET /imports/:jobId. With a real worker in place during cp2 we'd be
// blocking on cp3 before we could validate the upload + mapping
// surfaces. So the stub flips the row to READY with empty preview +
// counts so the polling path closes today.
//
// The wrapper-not-extension pattern: `tenantWorker(processor)` enforces
// `withTenant(job.data.schoolId)` BEFORE the processor body runs. Cp3
// replaces THIS body, not the wrapper — every validate worker iteration
// inherits the tenant-safety invariant.

@Processor(IMPORTS_QUEUE)
export class ImportsValidateProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsValidateProcessor.name);

  async process(job: Job): Promise<unknown> {
    if (job.name === IMPORTS_JOB_VALIDATE) {
      return this.handleValidate(job as Job<ValidateJobData>);
    }
    throw new Error(`unknown job name on imports queue: ${job.name}`);
  }

  // cp2 stub: flip the row to READY with empty preview + zero invalid
  // rows. totalRows is already set from the upload synchronous parse;
  // we set validRows = totalRows so the GET response is internally
  // consistent (the "ready to import" count matches the total). Cp3
  // overwrites these.
  private readonly handleValidate = tenantWorker<ValidateJobData, void>(
    async (job, db) => {
      this.logger.log(
        `cp2 stub: marking import ${job.data.jobId} as READY (real validation lands in cp3)`,
      );

      const existing = await db.importJob.findUnique({
        where: { id: job.data.jobId },
        select: { totalRows: true, status: true },
      });
      if (!existing) {
        // The row was deleted between enqueue and processing — nothing to
        // do. Don't throw, or BullMQ will retry forever.
        this.logger.warn(
          `cp2 stub: import ${job.data.jobId} no longer exists; skipping`,
        );
        return;
      }
      if (existing.status !== "VALIDATING") {
        this.logger.warn(
          `cp2 stub: import ${job.data.jobId} is in status ${existing.status}, not VALIDATING; skipping`,
        );
        return;
      }

      await db.importJob.update({
        where: { id: job.data.jobId },
        data: {
          status: "READY",
          validRows: existing.totalRows,
          invalidRows: 0,
          previewSnapshot: {
            good: [],
            bad: [],
          },
        },
      });
    },
  );
}
