import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
import { AI_QUEUE } from "../../common/queue/index.js";
import { AuthModule } from "../auth/auth.module.js";
import { AssignmentFeedbackService } from "./assignment-feedback.service.js";
import {
  AssignmentsController,
  PortalAssignmentsController,
  StudentAssignmentsController,
} from "./assignments.controller.js";
import { AssignmentsService } from "./assignments.service.js";
import { StagedFilesSweeperService } from "./staged-files-sweeper.service.js";

// Phase 9 / CP4 — assignments: submitted work and marking. Like homework, it
// imports no notifications module: nothing here sends a push (CP4-D10).
//
// CP4b adds AI drafts of marking feedback: AiModule (imported explicitly, so
// "who can call Claude" stays greppable) and the AI queue. The jobs are run by
// the one @Processor on that queue, in report-comments, which imports this
// module for AssignmentFeedbackService.
@Module({
  imports: [AuthModule, AiModule, BullModule.registerQueue({ name: AI_QUEUE })],
  controllers: [AssignmentsController, PortalAssignmentsController, StudentAssignmentsController],
  providers: [AssignmentsService, AssignmentFeedbackService, StagedFilesSweeperService],
  exports: [AssignmentFeedbackService],
})
export class AssignmentsModule {}
