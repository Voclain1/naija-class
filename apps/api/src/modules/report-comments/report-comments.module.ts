import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
import { AI_QUEUE } from "../../common/queue/index.js";
import { AuthModule } from "../auth/auth.module.js";
import { ParentSummariesModule } from "../parent-summaries/parent-summaries.module.js";
import { FormCommentsService } from "./form-comments.service.js";
import { ReportCommentsController } from "./report-comments.controller.js";
import { ReportCommentsService } from "./report-comments.service.js";
import { SubjectCommentProcessor } from "./workers/subject-comment.processor.js";

// Report-card subject comments — Phase 5 / Slice 3.
//
// AiModule is imported explicitly rather than being @Global(), same as
// LessonPlansModule: "who can call Claude" stays greppable, which matters for a
// surface governed by cost and PII hard rules.
@Module({
  imports: [
    AuthModule,
    AiModule,
    // Slice 5: SubjectCommentProcessor is the sole @Processor on AI_QUEUE and
    // now dispatches parent-summary jobs too, so it needs that service. One
    // direction only — ParentSummariesModule does not import this one.
    ParentSummariesModule,
    BullModule.registerQueue({
      name: AI_QUEUE,
      defaultJobOptions: {
        // Fewer attempts than the imports queue's 3. Every retry is a fresh
        // paid generation, and the failures worth retrying here are transient
        // network/429 ones — a refusal or a malformed response will fail the
        // same way twice. Two attempts buys the transient case without paying
        // three times for the deterministic one.
        attempts: 2,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  controllers: [ReportCommentsController],
  providers: [ReportCommentsService, FormCommentsService, SubjectCommentProcessor],
  exports: [ReportCommentsService, FormCommentsService],
})
export class ReportCommentsModule {}
