import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  bookOnboardingCallSchema,
  type BookOnboardingCallInput,
  type OnboardingCallBookingDto,
  type OnboardingCallStateDto,
  type PlatformOnboardingCallDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentPlatformAdmin } from "../../common/auth/current-platform-admin.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import type { PlatformAdminContext } from "../../common/auth/platform-admin-context.js";
import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { OnboardingCallPlatformService } from "./onboarding-call-platform.service.js";
import { OnboardingCallService } from "./onboarding-call.service.js";

// Setup calls (docs/modules/onboarding-call.md).

@Controller("schools/me/onboarding-call")
@UseGuards(AuthGuard)
export class OnboardingCallController {
  constructor(private readonly service: OnboardingCallService) {}

  @Get()
  state(@CurrentUser() ctx: AuthContext): Promise<OnboardingCallStateDto> {
    return this.service.state(ctx);
  }

  @Post()
  @HttpCode(200)
  book(
    @CurrentUser() ctx: AuthContext,
    @Body(new ZodValidationPipe(bookOnboardingCallSchema)) dto: BookOnboardingCallInput,
    @Ip() ip: string,
  ): Promise<OnboardingCallBookingDto> {
    return this.service.book(ctx, dto, ip ?? null);
  }

  @Post("skip")
  @HttpCode(204)
  skip(@CurrentUser() ctx: AuthContext, @Ip() ip: string): Promise<void> {
    return this.service.skip(ctx, ip ?? null);
  }
}

const markDoneSchema = z.object({ done: z.boolean() });

@Controller("platform-admin/onboarding-calls")
@UseGuards(PlatformAdminGuard)
export class PlatformOnboardingCallsController {
  constructor(private readonly service: OnboardingCallPlatformService) {}

  @Get()
  list(): Promise<PlatformOnboardingCallDto[]> {
    return this.service.listAll();
  }

  @Patch(":schoolId/:bookingId")
  @HttpCode(204)
  markDone(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("schoolId", ParseUUIDPipe) schoolId: string,
    @Param("bookingId", ParseUUIDPipe) bookingId: string,
    @Body(new ZodValidationPipe(markDoneSchema)) dto: { done: boolean },
  ): Promise<void> {
    return this.service.markDone(admin.userId, schoolId, bookingId, dto.done);
  }
}
