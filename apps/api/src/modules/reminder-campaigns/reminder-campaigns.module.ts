import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module";
import { FeatureSwitchesModule } from "../../common/features/feature-switches.module";
import { TermiiModule } from "../../common/termii/termii.module";
import { AuthModule } from "../auth/auth.module";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module";
import { ReminderCampaignRunnerService } from "./reminder-campaign-runner.service";
import { ReminderCampaignsController } from "./reminder-campaigns.controller";
import { ReminderCampaignsService } from "./reminder-campaigns.service";
import { LiveReminderSendPort, ReminderSendPort } from "./reminder-send.port";

// No AiModule, deliberately: nothing here calls a model.
@Module({
  imports: [AuthModule, FeatureSwitchesModule, EmailModule, TermiiModule, NotificationDispatchModule],
  controllers: [ReminderCampaignsController],
  providers: [ReminderCampaignsService, ReminderCampaignRunnerService, { provide: ReminderSendPort, useClass: LiveReminderSendPort }],
})
export class ReminderCampaignsModule {}
