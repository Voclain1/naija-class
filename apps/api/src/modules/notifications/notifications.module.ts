import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module";
import { PushModule } from "../../common/push/push.module";
import { PUSH_QUEUE } from "../../common/queue";
import { AnnouncementsModule } from "../announcements/announcements.module";
import { AuthModule } from "../auth/auth.module";
import { GuardianMessagingConsentController } from "./messaging/guardian-messaging-consent.controller";
import { MetaWebhookController } from "./messaging/meta-webhook.controller";
import { MetaWebhookService } from "./messaging/meta-webhook.service";
import { TermiiReportsController } from "./messaging/termii-reports.controller";
import { TermiiReportsService } from "./messaging/termii-reports.service";
import { MessagingWalletModule } from "./messaging/messaging-wallet.module";
import { PaidMessagingModule } from "./messaging/paid-messaging.module";
import { MessagingController } from "./messaging/messaging.controller";
import { NotificationDispatchModule } from "./notification-dispatch.module";
import { NotificationPreferencesController } from "./notification-preferences.controller";
import { PushProcessor } from "./push.processor";

// Exports NotificationPreferencesService so GuardiansModule and
// FinanceModule can inject it for enforcement (getEnabledChannels) without
// depending on each other — see docs/modules/phase-4.md §8 D5.
// Phase 6 / Slice 5 adds the push half: the dispatch service (which channel),
// the queue, and the processor (the actual send). It lives HERE rather than
// in a new module because the channel decision reads the very preferences
// this module already owns — a separate module would either duplicate that
// read or import this one for a single method.
// The worker lives HERE, and only here: a @Processor builds a BullMQ Worker
// that needs Redis at instantiation, so modules that merely SEND import
// NotificationDispatchModule instead.
@Module({
  imports: [
    AuthModule,
    EmailModule,
    MessagingWalletModule,
    PaidMessagingModule,
    AnnouncementsModule,
    PushModule,
    NotificationDispatchModule,
    BullModule.registerQueue({ name: PUSH_QUEUE }),
  ],
  controllers: [GuardianMessagingConsentController, MessagingController, MetaWebhookController, NotificationPreferencesController, TermiiReportsController],
  providers: [PushProcessor, MetaWebhookService, TermiiReportsService],
  exports: [NotificationDispatchModule],
})
export class NotificationsModule {}
