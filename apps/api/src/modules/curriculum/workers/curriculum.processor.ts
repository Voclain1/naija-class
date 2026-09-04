import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, UnrecoverableError } from "bullmq";

import { withTenant } from "@school-kit/db";
import { classifyVendorError } from "@school-kit/ai";

import { EmbeddingService } from "../../../common/embeddings/embedding.service";
import {
  CURRICULUM_JOB_EMBED,
  CURRICULUM_JOB_INGEST,
  CURRICULUM_QUEUE,
} from "../../../common/queue";
import { StorageService } from "../../../common/storage";
import type { EmbedJobData, IngestJobData } from "../curriculum.service";
import { runEmbedHandler } from "./embed.handler";
import { runIngestHandler } from "./ingest.handler";

// CurriculumProcessor — sole BullMQ entry for CURRICULUM_QUEUE.
//
// One @Processor class per queue, dispatching on job.name — the pattern
// ImportsProcessor established, for the reason its header gives:
// @nestjs/bullmq spawns one Worker per @Processor class, so a second class on
// this queue would load-balance ingest jobs across competing workers.
//
// Concurrency 2. Not 1, because a single school uploading a term's worth of
// documents should not queue behind itself; not higher, because every job
// here is spending money against a shared vendor rate limit, and the batching
// inside a job already extracts most of the available parallelism. The inner
// backoff handles contention between the two.
@Processor(CURRICULUM_QUEUE, { concurrency: 2 })
export class CurriculumProcessor extends WorkerHost {
  private readonly logger = new Logger(CurriculumProcessor.name);

  constructor(
    private readonly storage: StorageService,
    private readonly embeddings: EmbeddingService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === CURRICULUM_JOB_EMBED) {
      return this.handleEmbed(job as Job<EmbedJobData>);
    }
    // LEGACY (CP5). Nothing enqueues "ingest" any more — upload now writes its
    // chunks synchronously and stops at AWAITING_REVIEW, and embedding is
    // dispatched by approval. This branch stays so that jobs already sitting in
    // Redis when the gate deployed still drain correctly instead of throwing
    // "unknown job name" and failing documents that were mid-flight through no
    // fault of their own. Safe to delete once the queue has drained past the
    // deploy; not before.
    if (job.name === CURRICULUM_JOB_INGEST) {
      return this.handleIngest(job as Job<IngestJobData>);
    }
    throw new Error(`unknown job name on curriculum queue: ${job.name}`);
  }

  // Deliberately NOT wrapped in tenantWorker. tenantWorker opens ONE outer
  // withTenant transaction for the whole job, and this job spends minutes in
  // network calls between its database touches — holding a Postgres
  // transaction open across that would pin a connection for the duration and
  // block autovacuum on the tables it touched.
  //
  // Instead the handler opens a short withTenant per database step (claim,
  // write chunks, finalise), each with the GUC correctly set. The tenancy
  // guarantee tenantWorker exists to enforce is preserved; only its
  // transaction shape is refused, for the same reason the CSV importer's
  // commit handler refuses it.
  private readonly handleIngest = async (job: Job<IngestJobData>): Promise<void> => {
    if (!job.data?.schoolId || !job.data?.documentId) {
      throw new Error(
        `ingest: job ${job.id ?? "(no id)"} missing schoolId/documentId; refusing to run`,
      );
    }

    if (!this.embeddings.isConfigured()) {
      // Unrecoverable: retrying cannot conjure an API key, and burning three
      // attempts to say so just delays the FAILED status the teacher needs.
      throw new UnrecoverableError(
        "Embedding vendor is not configured on this deployment.",
      );
    }

    try {
      await runIngestHandler({
        documentId: job.data.documentId,
        schoolId: job.data.schoolId,
        storage: this.storage,
        embeddings: this.embeddings,
        logger: this.logger,
      });
    } catch (err) {
      // A FATAL vendor error (a bad key, a malformed request) will never
      // succeed on retry. Converting it here means the document reaches FAILED
      // immediately with an accurate message, instead of after three attempts
      // and fifteen seconds of backoff.
      //
      // A rate-limit or transient error is NOT converted: the inner backoff
      // already exhausted its attempts, and letting BullMQ retry the job gives
      // the vendor minutes rather than seconds to recover. That is D4a's
      // "a 429 must be a retry, not a FAILED document" at the outer layer.
      if (classifyVendorError(err) === "fatal" && !(err instanceof UnrecoverableError)) {
        throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  };

  // CP5 — embedding, dispatched by approval rather than by upload.
  //
  // Same tenancy shape as handleIngest and for the same reason: short
  // withTenant calls per database step rather than one outer transaction held
  // open across minutes of vendor calls.
  private readonly handleEmbed = async (job: Job<EmbedJobData>): Promise<void> => {
    if (!job.data?.schoolId || !job.data?.documentId) {
      throw new Error(
        `embed: job ${job.id ?? "(no id)"} missing schoolId/documentId; refusing to run`,
      );
    }

    if (!this.embeddings.isConfigured()) {
      throw new UnrecoverableError("Embedding vendor is not configured on this deployment.");
    }

    try {
      await runEmbedHandler({
        documentId: job.data.documentId,
        schoolId: job.data.schoolId,
        embeddings: this.embeddings,
        logger: this.logger,
      });
    } catch (err) {
      if (classifyVendorError(err) === "fatal" && !(err instanceof UnrecoverableError)) {
        throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  };

  @OnWorkerEvent("failed")
  async onFailed(job: Job<IngestJobData>, error: Error): Promise<void> {
    if (!job?.data?.schoolId || !job.data.documentId) {
      this.logger.error(
        `curriculum failed listener: job ${job?.id} missing schoolId/documentId; cannot mark FAILED`,
      );
      return;
    }

    const isUnrecoverable =
      error?.name === "UnrecoverableError" || error instanceof UnrecoverableError;
    const maxAttempts = job.opts?.attempts ?? 1;
    const exhausted = job.attemptsMade >= maxAttempts;

    if (!isUnrecoverable && !exhausted) {
      this.logger.warn(
        `curriculum: ingest ${job.data.documentId} attempt ${job.attemptsMade}/${maxAttempts} failed (retryable): ${error?.message}`,
      );
      return;
    }

    try {
      await withTenant(job.data.schoolId, async (db) => {
        await db.curriculumDocument.update({
          where: { id: job.data.documentId },
          // FAILED, not back to AWAITING_REVIEW. The teacher already reviewed
          // and approved this structure; sending them round the same screen a
          // second time would imply their review was the problem when the
          // failure is on the vendor side. reviewedBy/reviewedAt are left
          // intact so the approval survives the failure and a retry does not
          // need re-approving.
          data: { status: "FAILED", errorMessage: summarise(error, isUnrecoverable) },
        });
      });
    } catch (writeErr) {
      this.logger.error(
        `curriculum: failed to mark document ${job.data.documentId} as FAILED: ${
          writeErr instanceof Error ? writeErr.message : String(writeErr)
        }`,
      );
    }
  }
}

// errorMessage is shown to a teacher, so it stays short. It must also never
// carry document text: every message that reaches here originates from a
// parser error, a vendor status line, or our own control flow — none of which
// echo the document — and this truncation is the last guard on that.
function summarise(error: Error, isUnrecoverable: boolean): string {
  const prefix = isUnrecoverable ? "Could not process: " : "Retries exhausted: ";
  const message = error?.message ?? "unknown error";
  return prefix + (message.length > 400 ? `${message.slice(0, 397)}...` : message);
}
