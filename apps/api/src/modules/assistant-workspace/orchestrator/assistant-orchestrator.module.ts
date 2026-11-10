import { Module } from "@nestjs/common";

import { AiModule } from "../../../common/ai/ai.module";
import { FeatureSwitchesModule } from "../../../common/features/feature-switches.module";
import { AuthModule } from "../../auth/auth.module";
import { InvoicesModule } from "../../invoices/invoices.module";
import { ReminderCampaignsModule } from "../../reminder-campaigns/reminder-campaigns.module";
import { StudentCorrectionsModule } from "../../student-corrections/student-corrections.module";
import { StudentIntakeModule } from "../../student-intake/student-intake.module";
import { StudentsModule } from "../../students/students.module";
import { TeacherScopeModule } from "../../teacher-scope/teacher-scope.module";
import { StudentLookupService } from "../student-lookup.service";
import { AssistantWorkspaceService } from "../assistant-workspace.service";
import { AssistantOrchestratorController } from "./assistant-orchestrator.controller";
import { AssistantOrchestratorService } from "./assistant-orchestrator.service";
import { ModelRoutingGate } from "./model-routing-gate";

// The SchoolKit Assistant's model orchestration: the ONLY part of the
// assistant that calls the model. Its own module, so the workspace's own
// controller, service and module stay free of the AI stack.
// AssistantWorkspaceService is stateless; this module provides its own copy
// (with the gate) so the dependency runs one way.
@Module({
  imports: [AuthModule, FeatureSwitchesModule, AiModule, InvoicesModule, ReminderCampaignsModule, StudentIntakeModule, StudentCorrectionsModule, StudentsModule, TeacherScopeModule],
  controllers: [AssistantOrchestratorController],
  providers: [ModelRoutingGate, AssistantWorkspaceService, AssistantOrchestratorService, StudentLookupService],
  exports: [ModelRoutingGate],
})
export class AssistantOrchestratorModule {}
