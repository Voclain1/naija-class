import { Module } from "@nestjs/common";

import { FeatureSwitchesModule } from "../../common/features/feature-switches.module";
import { AuthModule } from "../auth/auth.module";
import { AssistantWorkspaceController } from "./assistant-workspace.controller";
import { AssistantWorkspaceService } from "./assistant-workspace.service";
import { StudentLookupService } from "./student-lookup.service";
import { StudentsModule } from "../students/students.module";
import { TeacherScopeModule } from "../teacher-scope/teacher-scope.module";
import { AssistantOrchestratorModule } from "./orchestrator/assistant-orchestrator.module";

// No AiModule, deliberately: the workspace routes requests without a model.
@Module({
  imports: [AuthModule, FeatureSwitchesModule, AssistantOrchestratorModule, StudentsModule, TeacherScopeModule],
  controllers: [AssistantWorkspaceController],
  providers: [AssistantWorkspaceService, StudentLookupService],
})
export class AssistantWorkspaceModule {}
