import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { calendarWindowQuerySchema, type CalendarResponse, type CalendarWindowQuery } from "@school-kit/types";

import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CalendarService } from "./calendar.service.js";

// Phase 8 / CP1 — the student's school calendar (D4). The school is the student
// session's school; the request cannot name one.
@Controller("student-portal")
export class StudentCalendarController {
  constructor(private readonly service: CalendarService) {}

  @Get("me/calendar")
  @UseGuards(StudentAuthGuard)
  async calendar(
    @CurrentStudent() ctx: StudentAuthContext,
    @Query(new ZodValidationPipe(calendarWindowQuerySchema)) window: CalendarWindowQuery,
  ): Promise<CalendarResponse> {
    return this.service.getStudentCalendar(ctx.schoolId, window);
  }
}
