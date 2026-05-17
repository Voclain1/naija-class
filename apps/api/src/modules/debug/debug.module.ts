import { Module } from "@nestjs/common";

import { DebugController } from "./debug.controller";

// Dev-only module. Not registered in AppModule when NODE_ENV === "production"
// — see app.module.ts.
@Module({
  controllers: [DebugController],
})
export class DebugModule {}
