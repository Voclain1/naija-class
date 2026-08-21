import { Body, Controller, Get, HttpCode, Ip, Post, UseGuards } from "@nestjs/common";
import {
  academicCalendarSchema,
  type AcademicCalendarInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AcademicCalendarService } from "./academic-calendar.service.js";

// The recovery surface for schools that finished onboarding BEFORE the
// calendar step existed — 23 of the 36 stuck schools in the 2026-08-21
// production census. Schools still in the wizard are served by onboarding
// step 5 instead; both call the same service method.
//
// Gated by role inside the service (owner/admin) rather than by
// @Permissions/PermissionsGuard here, matching how SchoolsController's own
// onboarding and patchMe handlers gate — this sits alongside them as school
// configuration, not as a permissioned academic-module surface. That choice
// is why AuthGuard alone appears below.
@Controller("schools/me/academic-calendar")
@UseGuards(AuthGuard)
export class AcademicCalendarController {
  constructor(private readonly service: AcademicCalendarService) {}

  // GET /schools/me/academic-calendar/status
  // Backs the in-app prompt. Cheap (one COUNT) because every admin page load
  // may ask. Intentionally readable by any authenticated staff member: a
  // bursar or teacher who is blocked by the missing calendar should be able
  // to SEE why, even though only owner/admin can fix it.
  @Get("status")
  async status(@CurrentUser() authCtx: AuthContext): Promise<{ needsCalendar: boolean }> {
    return this.service.getCalendarStatus(authCtx);
  }

  // POST /schools/me/academic-calendar
  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(academicCalendarSchema)) dto: AcademicCalendarInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<{ academicYearId: string; currentTermId: string }> {
    return this.service.createForSchool(authCtx, dto, { ipAddress: ip ?? null });
  }
}
