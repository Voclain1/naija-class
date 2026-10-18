import { Module } from "@nestjs/common";

import { NotificationDispatchModule } from "../notifications/notification-dispatch.module.js";
import { EventRsvpController, PortalEventRsvpController } from "./event-rsvp.controller.js";
import { EventRsvpService } from "./event-rsvp.service.js";

// Phase 9 / CP10.1 — event RSVPs. A module of its own, not part of
// CalendarModule: the reminder needs NotificationDispatchModule, which itself
// imports CalendarModule (quiet hours read the calendar).
@Module({
  imports: [NotificationDispatchModule],
  controllers: [EventRsvpController, PortalEventRsvpController],
  providers: [EventRsvpService],
})
export class EventRsvpModule {}
