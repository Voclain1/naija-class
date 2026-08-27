import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  acceptGuardianInvitationSchema,
  guardianForgotPasswordSchema,
  guardianLoginSchema,
  guardianResetPasswordSchema,
  type AcceptGuardianInvitationInput,
  type AcceptGuardianInvitationResponse,
  type GuardianForgotPasswordInput,
  type GuardianForgotPasswordResponse,
  type GuardianLoginInput,
  type GuardianLoginResponse,
  type GuardianResetPasswordInput,
  type GuardianResetPasswordResponse,
  type PublicGuardianInvitationDto,
} from "@school-kit/types";
import type { Request } from "express";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard";
import { RateLimitByEmailGuard } from "../../common/guards/rate-limit-by-email.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PortalAuthService } from "./portal-auth.service";

// FIVE PUBLIC endpoints (no @UseGuards(GuardianAuthGuard)) — none of them
// have a session yet by definition. Mirrors InvitationsController's
// "no guard" precedent for the same reason: the token / credentials
// themselves are the authorization. forgot-password and reset-password
// (2026-08-27) joined that set: a guardian who has forgotten their
// password cannot, by definition, hold a session.
//
// ONE GUARDED endpoint: POST /portal/logout, which needs to know WHICH
// session to destroy and therefore requires one.
//
// TWO callers, and they reach this controller differently:
//
//   apps/portal  — via its own Next.js server-side proxy route, never
//                  directly from a browser. See ARCHITECTURE.md §12 and
//                  apps/portal/src/app/api/portal/[...portal]/route.ts.
//                  CORS_ORIGIN_PORTAL is defense-in-depth in case that ever
//                  changes, not because the browser is expected to call
//                  these directly.
//   apps/mobile  — DIRECTLY, with `Authorization: Bearer` and no proxy
//                  (added Phase 6 / Slice 2, 2026-08-15). That is ADR-002's
//                  mobile transport, not a hole in the above: there is no
//                  cookie to protect and CORS is a browser concept that does
//                  not apply to a native runtime. No endpoint changed to
//                  support it.
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
  // Per-email limiter added 2026-08-27. Staff POST /auth/login has carried
  // RateLimitByEmailGuard since Phase 0; guardian login had only the
  // per-IP throttle, so credential-stuffing one parent's address from a
  // rotating pool of IPs was rate-limited far more weakly here than on the
  // staff surface. The guard is principal-agnostic (it keys off body.email),
  // so this is parity, not new machinery.
  @UseGuards(RateLimitByEmailGuard)
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

  // POST /portal/logout — the ONE guarded endpoint on this controller.
  // 204, no body: there is nothing useful to say, and the portal's proxy
  // route clears the sk_portal_session cookie on a 2xx.
  @Post("logout")
  @UseGuards(GuardianAuthGuard)
  @HttpCode(204)
  async logout(
    @CurrentGuardian() guardian: GuardianAuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.portalAuthService.logout(guardian, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // POST /portal/forgot-password — PUBLIC.
  //
  // Throttles mirror staff /auth/forgot-password exactly: 5/min per IP, plus
  // the per-email limiter. Tighter than login's 10/min because this endpoint
  // SENDS EMAIL — an unthrottled version is a spam cannon pointed at a
  // parent's inbox as much as it is an enumeration surface.
  @Post("forgot-password")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @UseGuards(RateLimitByEmailGuard)
  async forgotPassword(
    @Body(new ZodValidationPipe(guardianForgotPasswordSchema)) dto: GuardianForgotPasswordInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GuardianForgotPasswordResponse> {
    return this.portalAuthService.forgotPassword(dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // POST /portal/reset-password — PUBLIC. 20/min, same as staff's
  // equivalent: the token is already a 256-bit secret, so the throttle is
  // about limiting brute-force volume, not about being the primary defence.
  //
  // No RateLimitByEmailGuard here — this request carries no email field for
  // it to key on (deliberately: the reset form never asks who you are, the
  // token already knows).
  @Post("reset-password")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async resetPassword(
    @Body(new ZodValidationPipe(guardianResetPasswordSchema)) dto: GuardianResetPasswordInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GuardianResetPasswordResponse> {
    return this.portalAuthService.resetPassword(dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
