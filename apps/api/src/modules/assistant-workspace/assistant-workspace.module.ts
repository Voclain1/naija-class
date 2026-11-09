import { Module } from "@nestjs/common";

import { FeatureSwitchesModule } from "../../common/features/feature-switches.module";
import { AuthModule } from "../auth/auth.module";
import { AssistantWorkspaceController } from "./assistant-workspace.controller";
import { AssistantWorkspaceService } from "./assistant-workspace.service";
import { AssistantOrchestratorModule } from "./orchestrator/assistant-orchestrator.module";

// No AiModule, deliberately: the workspace routes requests without a model.
@Module({
  imports: [AuthModule, FeatureSwitchesModule, AssistantOrchestratorModule],
  controllers: [AssistantWorkspaceController],
  providers: [AssistantWorkspaceService],
})
export class AssistantWorkspaceModule {}
