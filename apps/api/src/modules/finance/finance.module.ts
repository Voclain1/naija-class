import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { TermiiModule } from "../../common/termii/termii.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";

@Module({
  // Phase 4 / Slice 6 — sendReminders now sends through EmailService/
  // TermiiService, gated by NotificationPreferencesService.
  imports: [EmailModule, TermiiModule, NotificationsModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
