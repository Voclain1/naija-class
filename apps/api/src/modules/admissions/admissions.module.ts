import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { TermiiModule } from "../../common/termii/termii.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module.js";
import { AdmissionAlertsService } from "./admission-alerts.service.js";
import { AdmissionsPublicController } from "./admissions-public.controller.js";
import { AdmissionsPublicService } from "./admissions-public.service.js";
import { AdmissionsPurgeService } from "./admissions-purge.service.js";
import { AdmissionsSettingsService } from "./admissions-settings.service.js";
import { AdmissionsController } from "./admissions.controller.js";
import { AdmissionsService } from "./admissions.service.js";

// Phase 9 / CP7 — online admission applications (docs/modules/phase-9.md §16).
@Module({
  imports: [AuthModule, EmailModule, NotificationDispatchModule, TermiiModule],
  controllers: [AdmissionsController, AdmissionsPublicController],
  providers: [AdmissionsService, AdmissionsSettingsService, AdmissionsPublicService, AdmissionAlertsService, AdmissionsPurgeService],
})
export class AdmissionsModule {}
