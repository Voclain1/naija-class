import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { REPORT_CARDS_QUEUE } from "../../common/queue/index.js";

import { CalendarModule } from "../calendar/calendar.module.js";
import { AnalyticsService } from "./analytics.service.js";
import { CompletenessService } from "./completeness.service.js";
import { ReportExportSweeperService } from "./report-export-sweeper.service.js";
import { ReportExportsService } from "./report-exports.service.js";
import { ReportsController } from "./reports.controller.js";
import { TableExportsController } from "./table-exports.controller.js";
import { TableExportsService } from "./table-exports.service.js";

// Phase 8 / CP2 — Recording Completeness. Imports CalendarModule for
// CalendarService.buildCalendar, the single calendar reader, which decides the
// holidays that are not school days (§16 D34).
//
// Phase 9 / CP1.1: registers REPORT_CARDS_QUEUE to hand PDF exports to the
// render worker (docs/modules/phase-9.md §8 CP1-D3). The options repeat
// ReportCardsModule's registration of the same queue, so a job behaves the
// same whichever module queued it.
@Module({
  imports: [
    CalendarModule,
    BullModule.registerQueue({
      name: REPORT_CARDS_QUEUE,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  controllers: [ReportsController, TableExportsController],
  providers: [CompletenessService, AnalyticsService, ReportExportsService, ReportExportSweeperService, TableExportsService],
})
export class ReportsModule {}
