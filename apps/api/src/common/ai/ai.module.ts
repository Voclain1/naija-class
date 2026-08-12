import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AiGenerationService } from "./ai-generation.service.js";

// Phase 5 / Slice 1 CP2. Feature modules import AiModule and inject
// AiGenerationService — they must never construct an Anthropic client
// themselves (enforced by the no-restricted-imports rule in
// packages/config/eslint/base.js).
//
// Not @Global(), unlike QueueModule: an explicit import in each feature module
// keeps "who can call Claude" greppable, which matters for a surface governed
// by cost and PII hard rules.
@Module({
  imports: [ConfigModule],
  providers: [AiGenerationService],
  exports: [AiGenerationService],
})
export class AiModule {}
