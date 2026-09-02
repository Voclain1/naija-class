import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { EmbeddingService } from "./embedding.service.js";

// Phase 7 / CP1. Feature modules import EmbeddingsModule and inject
// EmbeddingService — they must never call the Voyage endpoint themselves
// (enforced by the no-restricted-syntax rule in
// packages/config/eslint/base.js, which bans the base URL outside
// packages/ai/src/embeddings.ts).
//
// Not @Global(), for the same reason AiModule is not: an explicit import in
// each feature module keeps "who can spend money with an AI vendor" greppable.
@Module({
  imports: [ConfigModule],
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingsModule {}
