import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, UnrecoverableError } from "bullmq";

import { Prisma, withTenant } from "@school-kit/db";
import type {
  ImportJobPreviewSnapshot,
  StudentImportRow,
} from "@school-kit/types";

import {
  IMPORTS_JOB_COMMIT,
  IMPORTS_JOB_VALIDATE,
  IMPORTS_QUEUE,
  tenantWorker,
} from "../../../common/queue";
import { StorageService } from "../../../common/storage";
import type { CommitJobData, ValidateJobData } from "../imports.service";
import {
  EngineFatalError,
  parsePersistedMapping,
  runValidationEngine,
} from "../validate.engine";
import { runCommitHandler } from "./commit.handler";

// ImportsProcessor — sole BullMQ entry for IMPORTS_QUEUE.
//
// IMPORTANT: there is exactly ONE @Processor class on IMPORTS_QUEUE.
// @nestjs/bullmq spawns one BullMQ Worker per @Processor class
// (see bull.explorer.js / handleProcessor()). If two @Processor classes
// share a queue, BullMQ load-balances jobs across them, so a `commit`
// job would land on the wrong Worker ~half the time. Dispatch by
// `job.name` here is the correct pattern for multi-job-name queues.
// When slice 8 adds GUARDIANS / TEACHERS support it goes through more
// branches in this same dispatch, not a second @Processor class.
//
// Handlers live in sibling files (`validate.engine.ts` for validate
// logic; `commit.handler.ts` for commit logic). This file is the
// orchestration seam: it owns `process()` dispatch, the tenant guard,
// and the FailedJobEvent listener. The handlers are pure (or near-pure)
// functions so they can be tested without a Job/Worker harness.

@Processor(IMPORTS_QUEUE)
export class ImportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(private readonly storage: StorageService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === IMPORTS_JOB_VALIDATE) {
      return this.handleValidate(job as Job<ValidateJobData>);
    }
    if (job.name === IMPORTS_JOB_COMMIT) {
      return this.handleCommit(job as Job<CommitJobData>);
    }
    throw new Error(`unknown job name on imports queue: ${job.name}`);
  }

  // ---------------------------------------------------------------------
  // Validate handler — runs the engine, persists previewSnapshot + counts,
  // flips status VALIDATING → READY. Whole job runs inside one withTenant
  // transaction (tenantWorker wrapper); the engine + the update share it.
  //
  // Retryable vs fatal: EngineFatalError → UnrecoverableError so BullMQ
  // skips the remaining attempts. Anything else bubbles for retry.
  // ---------------------------------------------------------------------
  private readonly handleValidate = tenantWorker<ValidateJobData, void>(
    async (job, db) => {
      const { jobId, schoolId } = job.data;

      const existing = await db.importJob.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          status: true,
          columnMapping: true,
          type: true,
        },
      });
      if (!existing) {
        // Row gone between enqueue and processing (admin aborted, or a
        // race we don't expect). Don't throw or BullMQ retries forever.
        this.logger.warn(`validate: import ${jobId} no longer exists; skipping`);
        return;
      }
      if (existing.status !== "VALIDATING") {
        // Either already processed or deleted. Idempotent: do nothing.
        this.logger.warn(
          `validate: import ${jobId} is ${existing.status}, not VALIDATING; skipping`,
        );
        return;
      }
      if (existing.type !== "STUDENTS") {
        // Slice 8 adds GUARDIANS/TEACHERS.
        throw new UnrecoverableError(
          `validate: import ${jobId} type ${existing.type} is not handled in slice 6`,
        );
      }

      let mapping;
      try {
        mapping = parsePersistedMapping(existing.columnMapping);
      } catch (e) {
        if (e instanceof EngineFatalError) {
          throw new UnrecoverableError(e.message);
        }
        throw e;
      }

      let sourceBytes: Buffer;
      try {
        sourceBytes = await this.storage.get(schoolId, {
          kind: "import-source",
          jobId,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new UnrecoverableError(
          `validate: could not read source.csv for import ${jobId}: ${msg}`,
        );
      }

      let result;
      try {
        result = await runValidationEngine(
          db,
          sourceBytes,
          mapping.mapping,
          mapping.options,
        );
      } catch (e) {
        if (e instanceof EngineFatalError) {
          throw new UnrecoverableError(
            `validate: import ${jobId} ${e.kind}: ${e.message}`,
          );
        }
        throw e;
      }

      const previewSnapshot: ImportJobPreviewSnapshot = {
        good: result.good.slice(0, 50).map((g) => ({
          rowNumber: g.rowNumber,
          parsedRow: serialiseParsedRow(g.parsedRow),
        })),
        bad: result.bad.slice(0, 50).map((b) => ({
          rowNumber: b.rowNumber,
          csvRow: b.csvRow,
          errors: b.errors,
        })),
      };

      await db.importJob.update({
        where: { id: jobId },
        data: {
          status: "READY",
          totalRows: result.totalRows,
          validRows: result.good.length,
          invalidRows: result.bad.length,
          previewSnapshot: previewSnapshot as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `validate: import ${jobId} READY — total=${result.totalRows} valid=${result.good.length} invalid=${result.bad.length}`,
      );
    },
  );

  // ---------------------------------------------------------------------
  // Commit handler — re-streams source.csv, re-runs the engine (so
  // external dedup picks up any rows committed since validate ran —
  // including rows committed by a previous attempt of THIS worker after
  // a crash), inserts each good row in its OWN withTenant transaction,
  // then writes the merged error report to storage.
  //
  // CRITICAL: commit does NOT use tenantWorker. tenantWorker opens a
  // single outer withTenant() transaction; per-row commits need their
  // own transaction boundaries (otherwise one row's collision rolls
  // back the whole batch). Prisma does not nest transactions, so the
  // commit handler calls withTenant directly per operation.
  //
  // Retry safety: on worker crash mid-import, BullMQ retries. The
  // status-guard accepts `status === COMMITTING` (not strict-READY) so
  // the retry resumes. The re-validate's external dedup excludes any
  // students already committed by the previous attempt, so we never
  // try to insert them twice.
  // ---------------------------------------------------------------------
  private readonly handleCommit = async (job: Job<CommitJobData>): Promise<void> => {
    if (!job.data?.schoolId || !job.data?.jobId) {
      // Same defensive shape as tenantWorker — a job missing tenancy
      // data has no business running.
      throw new Error(
        `commit: job ${job.id ?? "(no id)"} missing schoolId/jobId; refusing to run`,
      );
    }
    await runCommitHandler({
      jobId: job.data.jobId,
      schoolId: job.data.schoolId,
      userId: job.data.userId,
      storage: this.storage,
      logger: this.logger,
    });
  };

  // ---------------------------------------------------------------------
  // FailedJobEvent listener — fires for BOTH validate and commit jobs
  // (one Worker per Processor class, one listener for all job names).
  // Writes ImportJob.status=FAILED on UnrecoverableError or on the last
  // exhausted attempt. The failure reason format is the same for both
  // job names; the entityId is jobId either way.
  // ---------------------------------------------------------------------
  @OnWorkerEvent("failed")
  async onFailed(
    job: Job<ValidateJobData | CommitJobData>,
    error: Error,
  ): Promise<void> {
    if (!job.data?.schoolId || !job.data?.jobId) {
      this.logger.error(
        `imports failed listener: job ${job.id} missing schoolId/jobId; cannot mark FAILED`,
      );
      return;
    }

    const isUnrecoverable =
      error?.name === "UnrecoverableError" ||
      error instanceof UnrecoverableError;
    const maxAttempts = job.opts?.attempts ?? 1;
    const exhausted = job.attemptsMade >= maxAttempts;

    if (!isUnrecoverable && !exhausted) {
      // BullMQ will retry — don't write FAILED yet.
      this.logger.warn(
        `imports: ${job.name} ${job.data.jobId} attempt ${job.attemptsMade}/${maxAttempts} failed (retryable): ${error?.message}`,
      );
      return;
    }

    const reason = summariseFailedReason(error, isUnrecoverable);
    try {
      await withTenant(job.data.schoolId, async (db) => {
        await db.importJob.update({
          where: { id: job.data.jobId },
          data: {
            status: "FAILED",
            failedReason: reason,
          },
        });
      });
    } catch (writeErr) {
      this.logger.error(
        `imports: failed to mark import ${job.data.jobId} as FAILED: ${
          writeErr instanceof Error ? writeErr.message : String(writeErr)
        }`,
      );
    }
  }
}

// JSON-friendly view of a parsed row for the previewSnapshot.good entries.
// Dates are stringified (so the wizard can render them); the schema's
// `undefined` optional fields are stripped (JSON can't carry undefined).
function serialiseParsedRow(
  parsed: StudentImportRow,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === undefined) continue;
    if (v instanceof Date) {
      out[k] = v.toISOString().slice(0, 10);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Keep `failedReason` short and human-readable. The full stack lives in
// BullMQ's job.failedReason already; ImportJob.failedReason is what the
// wizard shows to the admin, so verbose is unhelpful.
function summariseFailedReason(error: Error, isUnrecoverable: boolean): string {
  const prefix = isUnrecoverable ? "Fatal: " : "Retries exhausted: ";
  const message = error?.message ?? "unknown error";
  const trimmed = message.length > 500 ? message.slice(0, 497) + "..." : message;
  return prefix + trimmed;
}
