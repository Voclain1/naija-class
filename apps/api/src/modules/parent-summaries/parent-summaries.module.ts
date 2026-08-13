import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
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
// NO @Processor HERE, deliberately. SubjectCommentProcessor is the sole
// processor on AI_QUEUE and dispatches by job name — @nestjs/bullmq spawns one
// Worker per @Processor class, so a second class on this queue would
// load-balance AI jobs across competing workers. This module exports its
// service so that processor can call into it; the dependency runs one way
// (report-comments → parent-summaries) and there is no cycle.
//
// The queue IS registered here, because the weekly sweep produces jobs. Same
// defaultJobOptions as ReportCommentsModule's registration, intentionally
// identical: two registrations of one queue name with different retry
// behaviour would make a job's retry policy depend on which module happened to
// enqueue it.
@Module({
  imports: [
    AuthModule,
    AiModule,
    EmailModule,
    BullModule.registerQueue({
      name: AI_QUEUE,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  controllers: [ParentSummariesController, PortalParentSummariesController],
  providers: [ParentSummariesService],
  exports: [ParentSummariesService],
})
export class ParentSummariesModule {}
