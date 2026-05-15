import { Body, Controller, HttpCode, Ip, Post } from "@nestjs/common";
import { signupOwnerSchema, type SignupOwnerInput, type SignupOwnerResponse } from "@school-kit/types";
import type { Request } from "express";
import { Req } from "@nestjs/common";

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
}
