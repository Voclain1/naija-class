import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { TermiiModule } from "../../common/termii/termii.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module.js";
import { MessageAlertsService } from "./message-alerts.service.js";
import { MessagesCloseService } from "./messages-close.service.js";
import { MessagesSettingsService } from "./messages-settings.service.js";
import { MessagesController } from "./messages.controller.js";
import { MessagesService } from "./messages.service.js";
import { PortalMessagesController } from "./portal-messages.controller.js";
import { PortalMessagesService } from "./portal-messages.service.js";

// Phase 9 / CP8 — private messaging between families and the school
// (docs/modules/phase-9.md §17).
@Module({
  imports: [AuthModule, EmailModule, NotificationDispatchModule, TermiiModule],
  controllers: [MessagesController, PortalMessagesController],
  providers: [MessagesService, PortalMessagesService, MessagesSettingsService, MessageAlertsService, MessagesCloseService],
})
export class MessagesModule {}
