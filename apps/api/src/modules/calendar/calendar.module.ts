import { Module } from "@nestjs/common";

import { CalendarController } from "./calendar.controller.js";
import { CalendarService } from "./calendar.service.js";
import { PortalCalendarController } from "./portal-calendar.controller.js";
import { StudentCalendarController } from "./student-calendar.controller.js";

// Phase 8 / CP1 — Event Calendar. Three controllers, one service: staff,
// guardian and student reads all go through CalendarService.buildCalendar (D27).
@Module({
  controllers: [CalendarController, PortalCalendarController, StudentCalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
