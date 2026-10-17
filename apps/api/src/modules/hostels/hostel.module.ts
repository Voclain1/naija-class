import { Module } from "@nestjs/common";

import { TermiiModule } from "../../common/termii/termii.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { StudentChargeService } from "../finance/student-charge.service.js";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module.js";
import { BoardingController } from "./boarding.controller.js";
import { HostelExeatService } from "./hostel-exeat.service.js";
import { HostelHouseService } from "./hostel-house.service.js";
import { HostelController } from "./hostel.controller.js";
import { HostelService } from "./hostel.service.js";
import { PortalHostelController } from "./portal-hostel.controller.js";

// Phase 9 / CP6b — hostels and boarding. StudentChargeService is stateless and
// provided here too, as in TransportModule, for the HOSTEL charge.
@Module({
  imports: [AuthModule, NotificationDispatchModule, TermiiModule],
  controllers: [HostelController, BoardingController, PortalHostelController],
  providers: [HostelService, HostelHouseService, HostelExeatService, StudentChargeService],
  exports: [HostelService],
})
export class HostelModule {}
