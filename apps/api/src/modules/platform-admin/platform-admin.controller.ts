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
  platformAdminResolvePaystackSetupSchema,
  platformAdminSetAiEnabledSchema,
  platformAdminSetEarlyAccessSchema,
  platformAdminSetStaffMobileSchema,
  type PlatformAdminCreateSchoolInput,
  type PlatformAdminCreateSchoolResponse,
  type PlatformAdminListUsersQuery,
  type PlatformAdminLoginInput,
  type PlatformAdminLoginResponse,
  type PlatformAdminPaystackSetupRequestDto,
  type PlatformAdminPaystackSetupRevealDto,
  type PlatformAdminResolvePaystackSetupInput,
  type PlatformAdminResolvePaystackSetupResponse,
  type PlatformAdminSchoolDto,
  type PlatformAdminSetAiEnabledInput,
  type PlatformAdminSetAiEnabledResponse,
  type PlatformAdminSetEarlyAccessInput,
  type PlatformAdminSetEarlyAccessResponse,
  type PlatformAdminSetStaffMobileInput,
  type PlatformAdminSetStaffMobileResponse,
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

  // GET /platform-admin/paystack-setup-requests — the operator's queue of
  // schools waiting on a subaccount. No banking fields; see the service.
  @Get("paystack-setup-requests")
  @UseGuards(PlatformAdminGuard)
  async paystackSetupRequests(
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminPaystackSetupRequestDto[]> {
    return this.platformAdminService.listPaystackSetupRequests(adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /platform-admin/paystack-setup-requests/:id/reveal — the only route
  // in the product that returns a school's bank account number. Every call
  // writes a `paystack-setup.reveal` audit row. Throttled like a write, not
  // like a read: this is the one read whose repetition is itself a signal.
  @Get("paystack-setup-requests/:id/reveal")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async revealPaystackSetupRequest(
    @Param("id") id: string,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminPaystackSetupRevealDto> {
    return this.platformAdminService.revealPaystackSetupRequest(id, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // PATCH /platform-admin/paystack-setup-requests/:id — mark FULFILLED (with
  // the issued ACCT_ code) or REJECTED (with a reason the school sees).
  @Patch("paystack-setup-requests/:id")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async resolvePaystackSetupRequest(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(platformAdminResolvePaystackSetupSchema))
    dto: PlatformAdminResolvePaystackSetupInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminResolvePaystackSetupResponse> {
    return this.platformAdminService.resolvePaystackSetupRequest(id, dto, adminCtx, {
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

  // PATCH /platform-admin/schools/:schoolId/ai — turns the per-school AI kill
  // switch on or off (2026-08-14). Same throttle as the other two writes.
  //
  // Unlike early-access this one has real teeth: false stops every AI feature
  // for the school within one request (AiGenerationService.reserve() reads it
  // on the hot path), and true is how a school is opted INTO the one-at-a-time
  // rollout that packages/db/scripts/disable-ai-per-school.ts prepares. It is
  // still bounded by the platform-wide AI_ENABLED env var, which this
  // endpoint deliberately neither reads nor reports.
  @Patch("schools/:schoolId/ai")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setAiEnabled(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetAiEnabledSchema))
    dto: PlatformAdminSetAiEnabledInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetAiEnabledResponse> {
    return this.platformAdminService.setAiEnabled(schoolId, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Patch("schools/:schoolId/staff-mobile")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setStaffMobileEnabled(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetStaffMobileSchema)) dto: PlatformAdminSetStaffMobileInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetStaffMobileResponse> {
    return this.platformAdminService.setStaffMobileEnabled(schoolId, dto, adminCtx, {
      ipAddress: ip, userAgent: req.header("user-agent") ?? null,
    });
  }
}
