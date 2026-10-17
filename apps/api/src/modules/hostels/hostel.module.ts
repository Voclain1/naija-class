import { Module } from "@nestjs/common";

import { StudentChargeService } from "../finance/student-charge.service.js";
import { HostelController } from "./hostel.controller.js";
import { HostelService } from "./hostel.service.js";

// Phase 9 / CP6b — hostels and boarding. StudentChargeService is stateless and
// provided here too, as in TransportModule, for the HOSTEL charge.
@Module({
  controllers: [HostelController],
  providers: [HostelService, StudentChargeService],
  exports: [HostelService],
})
export class HostelModule {}
