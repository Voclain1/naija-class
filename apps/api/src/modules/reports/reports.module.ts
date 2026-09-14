import { Module } from "@nestjs/common";

import { CalendarModule } from "../calendar/calendar.module.js";
import { CompletenessService } from "./completeness.service.js";
import { ReportsController } from "./reports.controller.js";

// Phase 8 / CP2 — Recording Completeness. Imports CalendarModule for
// CalendarService.buildCalendar, the single calendar reader, which decides the
// holidays that are not school days (§16 D34).
@Module({
  imports: [CalendarModule],
  controllers: [ReportsController],
  providers: [CompletenessService],
})
export class ReportsModule {}
