import { Body, Controller, Get, HttpCode, Ip, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  platformAdminListUsersQuerySchema,
  platformAdminLoginSchema,
  type PlatformAdminListUsersQuery,
  type PlatformAdminLoginInput,
  type PlatformAdminLoginResponse,
  type PlatformAdminSchoolDto,
  type PlatformAdminUserDto,
} from "@school-kit/types";
import type { Request } from "express";

import { CurrentPlatformAdmin } from "../../common/auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../../common/auth/platform-admin-context";
import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PlatformAdminService } from "./platform-admin.service";

// Genuinely separate top-level surface — see CLAUDE.md's "Platform
// super-admin" note. /platform-admin/login is the ONLY public route here
// (mirrors PortalAuthController's "no guard on the credential endpoint
// itself" precedent); every other route requires PlatformAdminGuard.
@Controller("platform-admin")
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  // POST /platform-admin/login — same tighter-than-global throttle as
  // staff/guardian login.
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async login(
    @Body(new ZodValidationPipe(platformAdminLoginSchema)) dto: PlatformAdminLoginInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminLoginResponse> {
    return this.platformAdminService.login(dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Get("schools")
  @UseGuards(PlatformAdminGuard)
  async schools(
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSchoolDto[]> {
    return this.platformAdminService.listSchools(adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Get("users")
  @UseGuards(PlatformAdminGuard)
  async users(
    @Query(new ZodValidationPipe(platformAdminListUsersQuerySchema)) query: PlatformAdminListUsersQuery,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminUserDto[]> {
    return this.platformAdminService.listUsers(query.schoolId, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
