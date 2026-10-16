import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { TermiiModule } from "../../common/termii/termii.module.js";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";
import { StudentChargeService } from "./student-charge.service.js";
import { StudentChargesController } from "./student-charges.controller.js";

@Module({
  // Phase 4 / Slice 6 — sendReminders now sends through EmailService/
  // TermiiService, gated by NotificationPreferencesService.
  imports: [EmailModule, TermiiModule, NotificationDispatchModule],
  controllers: [FinanceController, StudentChargesController],
  providers: [FinanceService, StudentChargeService],
  exports: [FinanceService, StudentChargeService],
})
export class FinanceModule {}
