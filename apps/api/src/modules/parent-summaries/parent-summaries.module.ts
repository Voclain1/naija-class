import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
import { AI_QUEUE_JOB_OPTIONS } from "../../common/ai/ai-queue.module.js";
import { EmailModule } from "../../common/email/email.module.js";
import { AI_QUEUE } from "../../common/queue/index.js";
import { AuthModule } from "../auth/auth.module.js";
import { ParentSummariesController } from "./parent-summaries.controller.js";
import { ParentSummariesService } from "./parent-summaries.service.js";
import { PortalParentSummariesController } from "./portal-parent-summaries.controller.js";

// Weekly parent progress summary — Phase 5 / Slice 5.
//
// AiModule imported explicitly rather than @Global(), same as
// LessonPlansModule / ReportCommentsModule: "who can call Claude" stays
// greppable, which matters most for the one surface whose output nobody
// reviews before a parent reads it.
//
// NO @Processor HERE. The AI queue has one worker (common/ai/ai-queue.module.ts);
// ParentSummariesService registers its handler with AiJobRegistry. The queue
// IS registered here, because the weekly sweep produces jobs, with the shared
// AI_QUEUE_JOB_OPTIONS so a job's retries don't depend on who enqueued it.
@Module({
  imports: [
    AuthModule,
    AiModule,
    EmailModule,
    BullModule.registerQueue({
      name: AI_QUEUE,
      defaultJobOptions: AI_QUEUE_JOB_OPTIONS,
    }),
  ],
  controllers: [ParentSummariesController, PortalParentSummariesController],
  providers: [ParentSummariesService],
  exports: [ParentSummariesService],
})
export class ParentSummariesModule {}
