import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";

import { AI_QUEUE } from "../queue/index.js";
import { WORKER_TUNING } from "../queue/worker-tuning.js";
import { AiJobRegistry } from "./ai-jobs.registry.js";

// ---------------------------------------------------------------------------
// AiJobProcessor — the sole @Processor on AI_QUEUE.
//
// One @Processor class per queue (see ImportsProcessor's note): @nestjs/bullmq
// spawns one BullMQ Worker per class, so a second class on this queue would
// load-balance AI jobs across competing workers. A new AI feature registers a
// handler with AiJobRegistry; it never adds a @Processor.
//
// concurrency 3: these jobs are network-bound (a short Haiku call), not
// memory-bound like the Chromium renders on REPORT_CARDS_QUEUE. It stays low
// because every concurrent job is real money against the school's token budget
// and holds a Neon connection for its short transactions; the budget check is
// atomic (phase-5.md D5), so concurrency cannot overshoot the cap, but it sets
// how fast a runaway batch burns it.
//
// DELIBERATELY NOT `tenantWorker`. That helper wraps the WHOLE job in one
// withTenant transaction, and phase-5.md D1 forbids an LLM call inside one: a
// generation takes 10-30s against a 5s interactive-transaction limit. Each
// handler owns its own short transactions with the call between them; the
// registry checks schoolId (and the rest) is present before any handler runs.
// ---------------------------------------------------------------------------
@Processor(AI_QUEUE, { concurrency: 3, ...WORKER_TUNING.ai })
export class AiJobProcessor extends WorkerHost {
  private readonly logger = new Logger(AiJobProcessor.name);

  constructor(private readonly registry: AiJobRegistry) {
    super();
  }

  process(job: Job): Promise<unknown> {
    return this.registry.dispatch(job.name, job.id, job.data);
  }

  // A failed generation leaves no suggestion, which each feature's list already
  // shows honestly ("no suggestion yet", or a FAILED draft its handler wrote).
  // Here the only thing to do is make it visible in the logs.
  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.error(`${job?.name ?? "ai"} job ${job?.id ?? "(no id)"} failed (attempt ${job?.attemptsMade ?? 0}): ${err.message}`);
  }
}
