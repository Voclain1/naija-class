import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { AI_QUEUE } from "../queue/index.js";
import { AiJobProcessor } from "./ai-job.processor.js";
import { AiModule } from "./ai.module.js";

/**
 * Default options for every registration of AI_QUEUE. Each module that
 * enqueues registers the queue itself, and a registration's options apply to
 * the jobs it adds, so they must be the same everywhere, or a job's retries
 * would depend on which module enqueued it. Fewer attempts than the imports
 * queue's 3: every retry is a fresh paid generation, and the failures worth
 * retrying are transient network/429 ones.
 */
export const AI_QUEUE_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 },
} as const;

// The AI queue's worker. Imported once, by AppModule.
@Module({
  imports: [
    AiModule,
    BullModule.registerQueue({
      name: AI_QUEUE,
      defaultJobOptions: AI_QUEUE_JOB_OPTIONS,
    }),
  ],
  providers: [AiJobProcessor],
})
export class AiQueueModule {}
