import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module";
import { PUSH_QUEUE } from "../../common/queue";

import { AuthModule } from "../auth/auth.module";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module";
import {
  AnnouncementsController,
  PortalAnnouncementsController,
  StudentAnnouncementsController,
} from "./announcements.controller";
import { AnnouncementEmailService } from "./announcement-email.service";
import { AnnouncementsService } from "./announcements.service";
import { EmailPreferencesService } from "./email-preferences.service";
import { EmailUnsubscribeController, PortalEmailPreferencesController, ResendWebhookController } from "./email-preferences.controller";

// Announcements. Imports the DISPATCH module, not NotificationsModule: it
// sends and does not consume, and the worker needs Redis at instantiation.
// CP8.3: registers the push queue only to ADD announcement-email jobs; the
// push worker (NotificationsModule) runs them.
@Module({
  imports: [AuthModule, NotificationDispatchModule, EmailModule, BullModule.registerQueue({ name: PUSH_QUEUE })],
  controllers: [
    AnnouncementsController,
    PortalAnnouncementsController,
    StudentAnnouncementsController,
    EmailUnsubscribeController,
    PortalEmailPreferencesController,
    ResendWebhookController,
  ],
  providers: [AnnouncementsService, AnnouncementEmailService, EmailPreferencesService],
  exports: [AnnouncementsService, AnnouncementEmailService],
})
export class AnnouncementsModule {}
