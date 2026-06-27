import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  loginSchema,
  signupOwnerSchema,
  totpChallengeSchema,
  totpConfirmSchema,
  totpDisableSchema,
  type LoginInput,
  type LoginResponse,
  type MeResponse,
  type SignupOwnerInput,
  type SignupOwnerResponse,
  type TotpChallengeInput,
  type TotpConfirmInput,
  type TotpDisableInput,
  type TotpSetupResponseDto,
  type TotpStatusDto,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { RateLimitByEmailGuard } from "../../common/guards/rate-limit-by-email.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Public endpoint — no auth guard. Creates the school + owner user + owner
  // role grant + session in one shot. Response carries the bearer token in
  // the body; the client stores it server-side (HTTP-only cookie set by the
  // web app's Next.js handler) and sends it back as `Authorization: Bearer`.
  @Post("signup-owner")
  @HttpCode(201)
  async signupOwner(
    @Body(new ZodValidationPipe(signupOwnerSchema)) dto: SignupOwnerInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SignupOwnerResponse> {
    return this.authService.signupOwner(dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // Public endpoint. 200 (not 201) — no resource is created from the
  // caller's perspective; this is authentication, not registration.
  // Rate limits: 10 req/min per-IP (ThrottlerGuard global override) +
  // 20 req/15min per-email (RateLimitByEmailGuard, applied here).
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseGuards(RateLimitByEmailGuard)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<LoginResponse> {
    return this.authService.login(dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // Authenticated. Deletes the current session row and writes an audit
  // entry. 204 because there is no response body the client cares about.
  @Post("logout")
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.logout(user, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // Authenticated. Returns the current user, their school, and flattened
  // role + permission set. The client uses this to hydrate auth state after
  // a page reload — it's the canonical "am I logged in, and as whom?" call.
  @Get("me")
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthContext): Promise<MeResponse> {
    return this.authService.getMe(user);
  }

  // Returns whether 2FA is currently enabled for the authenticated user.
  // admin can read another owner's status via owner UI; both need auth.2fa.read.
  @Get("2fa/status")
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions("auth.2fa.read")
  async twoFactorStatus(@CurrentUser() user: AuthContext): Promise<TotpStatusDto> {
    return this.authService.getTwoFactorStatus(user.userId, user.schoolId);
  }

  // Owner-only. Generates a fresh TOTP secret stored as totp_pending_secret.
  // 2FA is NOT yet active — the owner must confirm with a code first.
  @Post("2fa/setup")
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions("auth.2fa.manage")
  async twoFactorSetup(@CurrentUser() user: AuthContext): Promise<TotpSetupResponseDto> {
    return this.authService.setupTwoFactor(user.userId, user.schoolId);
  }

  // Owner-only. Verifies the first code from the authenticator app and
  // activates 2FA. Clears totp_pending_secret on success.
  @Post("2fa/confirm")
  @HttpCode(204)
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions("auth.2fa.manage")
  async twoFactorConfirm(
    @CurrentUser() user: AuthContext,
    @Body(new ZodValidationPipe(totpConfirmSchema)) dto: TotpConfirmInput,
  ): Promise<void> {
    await this.authService.confirmTwoFactor(user.userId, user.schoolId, dto);
  }

  // Owner-only. Disables 2FA after verifying the owner's current password.
  // Defence-in-depth: a stolen session cannot silently remove the second factor.
  @Delete("2fa")
  @HttpCode(204)
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions("auth.2fa.manage")
  async twoFactorDisable(
    @CurrentUser() user: AuthContext,
    @Body(new ZodValidationPipe(totpDisableSchema)) dto: TotpDisableInput,
  ): Promise<void> {
    await this.authService.disableTwoFactor(user.userId, user.schoolId, dto);
  }

  // Public — no AuthGuard. Consumes the one-time challenge token issued by
  // POST /auth/login (when totp_enabled) and a live TOTP code. On success
  // issues a normal session (same response shape as a non-2FA login).
  // Throttle: 5 req / 5min per-IP — tighter than the login throttle because
  // the token is already rate-limited by the login endpoint that issued it;
  // this limit purely caps token-guess attempts.
  @Post("2fa/challenge")
  @HttpCode(200)
  @Throttle({ default: { ttl: 300_000, limit: 5 } })
  async twoFactorChallenge(
    @Body(new ZodValidationPipe(totpChallengeSchema)) dto: TotpChallengeInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<LoginResponse> {
    return this.authService.loginWithChallenge(dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
