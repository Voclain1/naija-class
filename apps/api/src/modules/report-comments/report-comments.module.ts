import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
import { AI_QUEUE_JOB_OPTIONS } from "../../common/ai/ai-queue.module.js";
import { AI_QUEUE } from "../../common/queue/index.js";
import { AuthModule } from "../auth/auth.module.js";
import { FormCommentsService } from "./form-comments.service.js";
import { ReportCommentsController } from "./report-comments.controller.js";
import { ReportCommentsService } from "./report-comments.service.js";

// Report-card subject comments — Phase 5 / Slice 3.
//
// AiModule is imported explicitly rather than being @Global(), same as
// LessonPlansModule: "who can call Claude" stays greppable, which matters for a
// surface governed by cost and PII hard rules. Its jobs run on the AI queue's
// one worker (common/ai/ai-queue.module.ts); each service registers its
// handler with AiJobRegistry.
@Module({
  imports: [
    AuthModule,
    AiModule,
    BullModule.registerQueue({ name: AI_QUEUE, defaultJobOptions: AI_QUEUE_JOB_OPTIONS }),
  ],
  controllers: [ReportCommentsController],
  providers: [ReportCommentsService, FormCommentsService],
  exports: [ReportCommentsService, FormCommentsService],
})
export class ReportCommentsModule {}
