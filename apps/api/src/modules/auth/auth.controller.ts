import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  loginSchema,
  signupOwnerSchema,
  type LoginInput,
  type LoginResponse,
  type MeResponse,
  type SignupOwnerInput,
  type SignupOwnerResponse,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
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
  @Post("login")
  @HttpCode(200)
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
}
