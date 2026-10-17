import { Module } from "@nestjs/common";

import { StudentChargeService } from "../finance/student-charge.service.js";
import { PortalTransportController } from "./portal-transport.controller.js";
import { TransportController } from "./transport.controller.js";
import { TransportService } from "./transport.service.js";

// Phase 9 / CP5.2 — transport. StudentChargeService is stateless and provided
// here too, as in InvoicesModule, so transport need not import the finance
// module (which sends reminders and email).
@Module({
  controllers: [TransportController, PortalTransportController],
  providers: [TransportService, StudentChargeService],
  exports: [TransportService],
})
export class TransportModule {}
