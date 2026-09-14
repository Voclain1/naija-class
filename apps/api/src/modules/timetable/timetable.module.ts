import { Module } from "@nestjs/common";

import { TimetableController } from "./timetable.controller.js";
import { TimetableService } from "./timetable.service.js";

// Phase 8 / CP3 — Timetable builder (docs/modules/phase-8.md §17).
@Module({
  controllers: [TimetableController],
  providers: [TimetableService],
})
export class TimetableModule {}
