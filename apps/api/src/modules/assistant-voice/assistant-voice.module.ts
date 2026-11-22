import { Module } from "@nestjs/common";

import { FeatureSwitchesModule } from "../../common/features/feature-switches.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AssistantOrchestratorModule } from "../assistant-workspace/orchestrator/assistant-orchestrator.module.js";
import { AssistantVoiceCoreModule } from "./assistant-voice-core.module.js";
import { AssistantVoiceController } from "./assistant-voice.controller.js";
import { AssistantVoiceService } from "./assistant-voice.service.js";

// Realtime voice for the SchoolKit Assistant (docs/modules/assistant-voice.md).
// It owns no tools and calls no model itself: turns go to the orchestrator's
// own AssistantOrchestratorService, imported from its module.
@Module({
  imports: [AuthModule, FeatureSwitchesModule, AssistantOrchestratorModule, AssistantVoiceCoreModule],
  controllers: [AssistantVoiceController],
  providers: [AssistantVoiceService],
})
export class AssistantVoiceModule {}
