import { Body, Controller, Get, HttpCode, Ip, Post, UseGuards } from "@nestjs/common";
import {
  confirmSchoolDataProtectionSchema,
  guardianConsentSchema,
  type ConfirmSchoolDataProtectionInput,
  type GuardianConsentDto,
  type GuardianConsentInput,
  type SchoolDataProtectionDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { DataProtectionService } from "./data-protection.service.js";

// Data protection consent (docs/modules/data-protection.md).

@Controller("schools/me/data-protection")
@UseGuards(AuthGuard)
export class SchoolDataProtectionController {
  constructor(private readonly service: DataProtectionService) {}

  @Get()
  get(@CurrentUser() ctx: AuthContext): Promise<SchoolDataProtectionDto> {
    return this.service.school(ctx);
  }

  @Post("confirm")
  @HttpCode(200)
  confirm(
    @CurrentUser() ctx: AuthContext,
    @Body(new ZodValidationPipe(confirmSchoolDataProtectionSchema)) _dto: ConfirmSchoolDataProtectionInput,
    @Ip() ip: string,
  ): Promise<SchoolDataProtectionDto> {
    return this.service.confirmSchool(ctx, { ipAddress: ip ?? null });
  }
}

@Controller("portal/me/consent")
@UseGuards(GuardianAuthGuard)
export class GuardianConsentController {
  constructor(private readonly service: DataProtectionService) {}

  @Get()
  get(@CurrentGuardian() ctx: GuardianAuthContext): Promise<GuardianConsentDto> {
    return this.service.guardian(ctx.schoolId, ctx.guardianId);
  }

  @Post()
  @HttpCode(200)
  consent(
    @CurrentGuardian() ctx: GuardianAuthContext,
    @Body(new ZodValidationPipe(guardianConsentSchema)) _dto: GuardianConsentInput,
    @Ip() ip: string,
  ): Promise<GuardianConsentDto> {
    return this.service.consentGuardian(ctx.schoolId, ctx.guardianId, { ipAddress: ip ?? null });
  }
}
