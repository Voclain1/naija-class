import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { InsightsController } from "./insights.controller.js";
import { InsightsService } from "./insights.service.js";

// AiModule imported explicitly (not @Global) — same as every other AI
// consumer, so "who can reach Claude" stays greppable.
@Module({
  imports: [AuthModule, AiModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
