import { Module } from "@nestjs/common";

import { StudentChargeService } from "../finance/student-charge.service.js";
import { BoardingController } from "./boarding.controller.js";
import { HostelHouseService } from "./hostel-house.service.js";
import { HostelController } from "./hostel.controller.js";
import { HostelService } from "./hostel.service.js";
import { PortalHostelController } from "./portal-hostel.controller.js";

// Phase 9 / CP6b — hostels and boarding. StudentChargeService is stateless and
// provided here too, as in TransportModule, for the HOSTEL charge.
@Module({
  controllers: [HostelController, BoardingController, PortalHostelController],
  providers: [HostelService, HostelHouseService, StudentChargeService],
  exports: [HostelService],
})
export class HostelModule {}
