import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { PortalHealthController } from "./portal-health.controller.js";

// Phase 9 / CP3 — health records and the sickbay (docs/modules/phase-9.md §10).
@Module({
  imports: [AuthModule],
  controllers: [HealthController, PortalHealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
