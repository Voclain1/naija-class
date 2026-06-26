import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  acceptInvitationSchema,
  type AcceptInvitationInput,
  type AcceptInvitationResponse,
  type PublicInvitationDto,
} from "@school-kit/types";
import type { Request } from "express";

import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { InvitationsService } from "./invitations.service";

// Two PUBLIC endpoints (no @UseGuards(AuthGuard)) — accepting an invitation
// is by definition something a user does before they have a session. The
// token itself is the authorization: knowing the random 32-byte secret
// proves the holder controls (or was forwarded) the email it was sent to.
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  // GET /invitations/:token — return public-safe metadata for the accept page.
  // Rate limit: 30 req/min per-IP (tighter than global 200 to reduce token
  // enumeration surface).
  @Get(":token")
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async get(@Param("token") token: string): Promise<PublicInvitationDto> {
    return this.invitationsService.getByToken(token);
  }

  // POST /invitations/:token/accept — set password, create the user, mint
  // a session. 200 (not 201) for the same reason auth.login is 200: a new
  // user IS created here, but the response shape the caller acts on is the
  // session, which is "authentication" not "registration". Keeping it 200
  // means the client can treat signup, login, and accept identically.
  // Rate limit: 20 req/min per-IP (stricter than GET — submitting credentials).
  @Post(":token/accept")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async accept(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(acceptInvitationSchema)) dto: AcceptInvitationInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AcceptInvitationResponse> {
    return this.invitationsService.accept(token, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
