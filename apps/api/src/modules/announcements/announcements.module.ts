import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module";
import {
  AnnouncementsController,
  PortalAnnouncementsController,
  StudentAnnouncementsController,
} from "./announcements.controller";
import { AnnouncementsService } from "./announcements.service";

// Announcements. Imports the DISPATCH module, not NotificationsModule: it
// sends and does not consume, and the worker needs Redis at instantiation.
@Module({
  imports: [AuthModule, NotificationDispatchModule],
  controllers: [AnnouncementsController, PortalAnnouncementsController, StudentAnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
