import { Module } from "@nestjs/common";

import { TimetableFamilyReader } from "./timetable-family-reader.js";
import { PortalTimetableController, StudentTimetableController, TeacherTimetableController } from "./timetable-read.controllers.js";
import { TimetableTeacherReader } from "./timetable-teacher-reader.js";
import { TimetableController } from "./timetable.controller.js";
import { TimetableService } from "./timetable.service.js";

// Phase 8 / CP3 — Timetable builder (docs/modules/phase-8.md §17).
// Phase 8 / CP4 — lifecycle, publishing and read surfaces (§18): the teacher
// reader (live timetable) and THE family reader (published snapshots only).
@Module({
  controllers: [TimetableController, TeacherTimetableController, PortalTimetableController, StudentTimetableController],
  providers: [TimetableService, TimetableTeacherReader, TimetableFamilyReader],
})
export class TimetableModule {}
