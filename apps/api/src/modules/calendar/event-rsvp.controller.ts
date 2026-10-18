import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import { answerRsvpSchema, type AnswerRsvpInput, type EventRsvpListDto, type FamilyRsvpDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { EventRsvpService } from "./event-rsvp.service.js";

// Phase 9 / CP10.1 — event RSVPs (docs/modules/phase-9.md §19.2).

/** The school's view of the replies: calendar-event.update (owner, admin), role-checked again in the service. */
@Controller("calendar/events")
@UseGuards(AuthGuard, PermissionsGuard)
export class EventRsvpController {
  constructor(private readonly service: EventRsvpService) {}

  @Get(":id/rsvps")
  @Permissions("calendar-event.update")
  list(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<EventRsvpListDto> {
    return this.service.list(authCtx, id);
  }
}

/** A parent's own answer. Only to an event that asks them. */
@Controller("portal/calendar/events")
@UseGuards(GuardianAuthGuard)
export class PortalEventRsvpController {
  constructor(private readonly service: EventRsvpService) {}

  @Post(":id/rsvp")
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  answer(
    @CurrentGuardian() g: GuardianAuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(answerRsvpSchema)) dto: AnswerRsvpInput,
    @Ip() ip: string,
  ): Promise<FamilyRsvpDto> {
    return this.service.answer(g, id, dto, { ipAddress: ip });
  }
}
