import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import {
  AssignmentsController,
  PortalAssignmentsController,
  StudentAssignmentsController,
} from "./assignments.controller.js";
import { AssignmentsService } from "./assignments.service.js";

// Phase 9 / CP4 — assignments: submitted work and marking. Like homework, it
// imports no notifications module: nothing here sends a push (CP4-D10).
@Module({
  imports: [AuthModule],
  controllers: [AssignmentsController, PortalAssignmentsController, StudentAssignmentsController],
  providers: [AssignmentsService],
})
export class AssignmentsModule {}
