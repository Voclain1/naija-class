import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, UnrecoverableError } from "bullmq";

import { Prisma, withTenant } from "@school-kit/db";
import type {
  ImportJobPreviewSnapshot,
  StudentImportRow,
} from "@school-kit/types";

import {
  IMPORTS_JOB_VALIDATE,
  IMPORTS_QUEUE,
  tenantWorker,
} from "../../../common/queue";
import { StorageService } from "../../../common/storage";
import type { ValidateJobData } from "../imports.service";
import {
  EngineFatalError,
  parsePersistedMapping,
  runValidationEngine,
} from "../validate.engine";

// cp3 real validate processor. Replaces the cp2 stub body — the
// tenantWorker wrapper + queue registration stay; only the per-job logic
// changes.
//
// Pipeline per job:
//   1. Load ImportJob row (must be in VALIDATING — we only ever enqueue
//      one validate job per row, and the cp2 mapping endpoint sets the
//      status before enqueuing).
//   2. Stream source.csv from storage (5 MB cap was enforced at upload;
//      we read the whole thing into a Buffer).
//   3. Run runValidationEngine (parsing + per-row validation + in-file
//      dedup + ONE external dedup query). The engine throws
//      EngineFatalError for unrecoverable inputs.
//   4. Update ImportJob: status=READY, totalRows, validRows, invalidRows,
//      previewSnapshot { good: first 50, bad: first 50 }.
//
// Retryable vs fatal:
//   - EngineFatalError → throw UnrecoverableError so BullMQ skips the
//     remaining 2 attempts. The FailedJobEvent listener at the bottom
//     of this file writes ImportJob.status=FAILED with failedReason.
//   - Anything else (DB transient, Redis blip, etc.) → bubble up so
//     BullMQ retries per the queue's `attempts: 3` config.
//
// All DB work runs inside withTenant via the tenantWorker wrapper —
// FORCE RLS scopes every read/write to the school. No basePrisma here;
// the lint rule enforces this.

@Processor(IMPORTS_QUEUE)
export class ImportsValidateProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsValidateProcessor.name);

  constructor(private readonly storage: StorageService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === IMPORTS_JOB_VALIDATE) {
      return this.handleValidate(job as Job<ValidateJobData>);
    }
    throw new Error(`unknown job name on imports queue: ${job.name}`);
  }

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
        // cp3 only handles STUDENTS. Slice 8 adds GUARDIANS/TEACHERS.
        throw new UnrecoverableError(
          `validate: import ${jobId} type ${existing.type} is not handled in slice 6`,
        );
      }

      // Mapping was validated at write time, but defensively re-parse.
      // A corrupted JSON column would throw EngineFatalError below.
      let mapping;
      try {
        mapping = parsePersistedMapping(existing.columnMapping);
      } catch (e) {
        if (e instanceof EngineFatalError) {
          throw new UnrecoverableError(e.message);
        }
        throw e;
      }

      // Read source.csv. A missing file is a fatal error — the upload
      // path always writes it, so the only way to see this is manual
      // tampering with the storage backend. Don't retry — just FAIL.
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

      // Run the engine. EngineFatalError → UnrecoverableError so BullMQ
      // doesn't burn its retry budget on a corrupt file.
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
          // Prisma's Json input type is JsonNull | InputJsonValue, neither
          // of which an unconstrained Record satisfies directly. We've
          // shape-checked previewSnapshot ourselves; cast through Prisma's
          // InputJsonValue to satisfy the column.
          previewSnapshot: previewSnapshot as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `validate: import ${jobId} READY — total=${result.totalRows} valid=${result.good.length} invalid=${result.bad.length}`,
      );
    },
  );

  // ---------------------------------------------------------------------
  // FailedJobEvent listener. BullMQ fires this on every failure (each
  // attempt) — we only want to write FAILED on the LAST attempt (or
  // immediately for UnrecoverableError). For UnrecoverableError, BullMQ
  // skips remaining retries and the failed event fires once with
  // attemptsMade === 1 (or whatever attempt threw); detect that via the
  // error name.
  // ---------------------------------------------------------------------
  @OnWorkerEvent("failed")
  async onFailed(job: Job<ValidateJobData>, error: Error): Promise<void> {
    // Defensive — a job with no schoolId in data can't be tenant-scoped.
    // tenantWorker refuses these at process time; the failed event still
    // fires, but we have nowhere safe to write.
    if (!job.data?.schoolId || !job.data?.jobId) {
      this.logger.error(
        `validate failed listener: job ${job.id} missing schoolId/jobId; cannot mark FAILED`,
      );
      return;
    }

    const isUnrecoverable =
      error?.name === "UnrecoverableError" ||
      // bullmq instanceof check across the unbundled module boundary is
      // unreliable on Windows pnpm setups; fall back to name match.
      error instanceof UnrecoverableError;
    const maxAttempts = job.opts?.attempts ?? 1;
    const exhausted = job.attemptsMade >= maxAttempts;

    if (!isUnrecoverable && !exhausted) {
      // BullMQ will retry — don't write FAILED yet, or a later success
      // would have to overwrite it. Log and bail.
      this.logger.warn(
        `validate: import ${job.data.jobId} attempt ${job.attemptsMade}/${maxAttempts} failed (retryable): ${error?.message}`,
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
        `validate: failed to mark import ${job.data.jobId} as FAILED: ${
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
