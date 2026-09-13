import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { calendarWindowQuerySchema, type CalendarResponse, type CalendarWindowQuery } from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CalendarService } from "./calendar.service.js";

// Phase 8 / CP1 — the guardian's school calendar (D4: visible to all users).
// The school is the guardian session's school; the request cannot name one.
// Serves apps/portal (via its proxy) and apps/mobile (Bearer) alike.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalCalendarController {
  constructor(private readonly service: CalendarService) {}

  @Get("calendar")
  async calendar(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Query(new ZodValidationPipe(calendarWindowQuerySchema)) window: CalendarWindowQuery,
  ): Promise<CalendarResponse> {
    return this.service.getGuardianCalendar(guardianCtx.schoolId, window);
  }
}
