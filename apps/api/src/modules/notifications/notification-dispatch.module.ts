import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { PUSH_QUEUE } from "../../common/queue";
import { AuthModule } from "../auth/auth.module";
import { CalendarModule } from "../calendar/calendar.module";
import { EventNotifierService } from "./event-notifier.service";
import { NotificationDispatchService } from "./notification-dispatch.service";
import { NotificationPreferencesModule } from "./notification-preferences.module";
import { PaidMessagingModule } from "./messaging/paid-messaging.module";
import { TeacherRemindersService } from "./teacher-reminders.service";

// The SENDING half of notifications, without the worker.
//
// Split out of NotificationsModule (2026-09-23) for a reason CI found rather
// than a tidiness one: wiring notifications into PaymentsModule dragged the
// @Processor with it, and a @Processor constructs a BullMQ Worker, which
// demands a live Redis connection the moment the module is instantiated —
// breaking every spec that builds a testing module around payments.
//
// Enqueuing needs only a Queue (lazy). Consuming needs a Worker. So callers
// import THIS, and the worker stays in NotificationsModule, which the app
// boots once.
@Module({
  imports: [AuthModule, CalendarModule, NotificationPreferencesModule, PaidMessagingModule, BullModule.registerQueue({ name: PUSH_QUEUE })],
  providers: [
    NotificationDispatchService,
    EventNotifierService,
    TeacherRemindersService,
  ],
  exports: [NotificationPreferencesModule, NotificationDispatchService, EventNotifierService],
})
export class NotificationDispatchModule {}
