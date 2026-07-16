import { Body, Controller, Get, HttpCode, Ip, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  acceptGuardianInvitationSchema,
  guardianLoginSchema,
  type AcceptGuardianInvitationInput,
  type AcceptGuardianInvitationResponse,
  type GuardianLoginInput,
  type GuardianLoginResponse,
  type PublicGuardianInvitationDto,
} from "@school-kit/types";
import type { Request } from "express";

import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PortalAuthService } from "./portal-auth.service";

// Three PUBLIC endpoints (no @UseGuards(GuardianAuthGuard)) — none of them
// have a session yet by definition. Mirrors InvitationsController's
// "no guard" precedent for the same reason: the token / credentials
// themselves are the authorization.
//
// This controller is called ONLY by apps/portal's own Next.js server-side
// proxy route (never directly by a browser) — see ARCHITECTURE.md §12 and
// apps/portal/src/app/api/portal/[...portal]/route.ts. CORS_ORIGIN_PORTAL
// exists as defense-in-depth in case that ever changes, not because the
// browser is expected to call these directly.
@Controller("portal")
export class PortalAuthController {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  // POST /portal/login — rate limit mirrors staff /auth/login precedent
  // (deferred.md notes staff login's own rate limiting; this endpoint gets
  // the same tighter-than-global throttle up front rather than deferring it
  // a second time).
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async login(
    @Body(new ZodValidationPipe(guardianLoginSchema)) dto: GuardianLoginInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GuardianLoginResponse> {
    return this.portalAuthService.login(dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /portal/invitations/:token — same 30/min throttle as staff's
  // equivalent public GET.
  @Get("invitations/:token")
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async getInvitation(@Param("token") token: string): Promise<PublicGuardianInvitationDto> {
    return this.portalAuthService.getByToken(token);
  }

  // POST /portal/invitations/:token/accept — same 20/min throttle as
  // staff's equivalent public accept.
  @Post("invitations/:token/accept")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async acceptInvitation(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(acceptGuardianInvitationSchema)) dto: AcceptGuardianInvitationInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AcceptGuardianInvitationResponse> {
    return this.portalAuthService.acceptInvitation(token, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
