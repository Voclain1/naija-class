import { Module } from "@nestjs/common";

import { TermiiModule } from "../../common/termii/termii.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { PortalHealthController } from "./portal-health.controller.js";
import { SickbayController } from "./sickbay.controller.js";
import { SickbayService } from "./sickbay.service.js";

// Phase 9 / CP3 — health records and the sickbay (docs/modules/phase-9.md §10).
@Module({
  imports: [AuthModule, NotificationDispatchModule, TermiiModule],
  controllers: [HealthController, SickbayController, PortalHealthController],
  providers: [HealthService, SickbayService],
  exports: [HealthService],
})
export class HealthModule {}
