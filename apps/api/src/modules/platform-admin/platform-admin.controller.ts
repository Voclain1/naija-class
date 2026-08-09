import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  platformAdminCreateSchoolSchema,
  platformAdminListUsersQuerySchema,
  platformAdminLoginSchema,
  platformAdminSetEarlyAccessSchema,
  type PlatformAdminCreateSchoolInput,
  type PlatformAdminCreateSchoolResponse,
  type PlatformAdminListUsersQuery,
  type PlatformAdminLoginInput,
  type PlatformAdminLoginResponse,
  type PlatformAdminSchoolDto,
  type PlatformAdminSetEarlyAccessInput,
  type PlatformAdminSetEarlyAccessResponse,
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

  // POST /platform-admin/schools — the surface's first write (2026-08-07).
  // Tighter throttle than the read endpoints: a compromised platform-admin
  // session can now trigger real school creation + real email sends to
  // arbitrary addresses, not just read data — bound the blast radius.
  @Post("schools")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async createSchool(
    @Body(new ZodValidationPipe(platformAdminCreateSchoolSchema)) dto: PlatformAdminCreateSchoolInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminCreateSchoolResponse> {
    return this.platformAdminService.createSchool(dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // PATCH /platform-admin/schools/:schoolId/early-access — sets/clears the
  // early-access marker (2026-08-09). Marker only; nothing reads it to make a
  // decision yet. Same throttle as createSchool: it's a write on a
  // cross-tenant surface, even though a much smaller one.
  @Patch("schools/:schoolId/early-access")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setEarlyAccess(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetEarlyAccessSchema))
    dto: PlatformAdminSetEarlyAccessInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetEarlyAccessResponse> {
    return this.platformAdminService.setEarlyAccess(schoolId, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
