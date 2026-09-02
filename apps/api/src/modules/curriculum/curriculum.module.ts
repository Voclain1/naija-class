import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { EmbeddingsModule } from "../../common/embeddings/embeddings.module";
import { CURRICULUM_QUEUE } from "../../common/queue";
import { StorageModule } from "../../common/storage/storage.module";
import { AuthModule } from "../auth/auth.module";
import { CurriculumController } from "./curriculum.controller";
import { CurriculumService } from "./curriculum.service";
import { CurriculumProcessor } from "./workers/curriculum.processor";

// CurriculumModule — Phase 7 / CP2.
//
// ONE @Processor class on CURRICULUM_QUEUE, dispatching by job.name — the same
// rule ImportsModule's header states, and it holds here for the same reason.
//
// EmbeddingsModule is imported explicitly rather than being @Global(), so that
// "which modules can spend money with an AI vendor" stays greppable. This is
// the first feature module to import it.
@Module({
  imports: [
    AuthModule,
    StorageModule,
    EmbeddingsModule,
    BullModule.registerQueue({
      name: CURRICULUM_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        // 5s rather than the importer's 1s: the failures this outer retry
        // covers are a dead worker or an exhausted inner backoff, and in both
        // cases an immediate retry is the least likely to help.
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  controllers: [CurriculumController],
  providers: [CurriculumService, CurriculumProcessor],
  exports: [CurriculumService],
})
export class CurriculumModule {}
