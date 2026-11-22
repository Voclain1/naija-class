import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { AssistantVoiceCoreModule } from "../assistant-voice/assistant-voice-core.module.js";
import { AiTermsController } from "./ai-terms.controller.js";
import { AiTermsService } from "./ai-terms.service.js";

// School owner acceptance of the SchoolKit Assistant AI terms. Uses the voice
// ledger only to end live voice sessions when the terms are withdrawn.
@Module({
  imports: [AuthModule, AssistantVoiceCoreModule],
  controllers: [AiTermsController],
  providers: [AiTermsService],
})
export class AiTermsModule {}
