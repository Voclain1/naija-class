import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AiUsageController } from "./ai-usage.controller.js";
import { AiUsageService } from "./ai-usage.service.js";

// AiModule imported for AiGenerationService.isConfigured() only — this module
// never generates. Same explicit (non-@Global) import as every other AI
// consumer, so "who can reach Claude" stays greppable.
@Module({
  imports: [AuthModule, AiModule],
  controllers: [AiUsageController],
  providers: [AiUsageService],
})
export class AiUsageModule {}
