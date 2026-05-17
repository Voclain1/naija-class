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
  inviteAdminSchema,
  type InviteAdminInput,
  type InviteAdminResponse,
  type PendingInvitationDto,
  type UserListItemDto,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /users — list users in the current school (excluding self).
  @Get()
  async list(@CurrentUser() authCtx: AuthContext): Promise<UserListItemDto[]> {
    return this.usersService.listUsers(authCtx);
  }

  // GET /users/invitations — list pending (not accepted, not expired)
  // invitations for the current school.
  @Get("invitations")
  async listInvitations(
    @CurrentUser() authCtx: AuthContext,
  ): Promise<PendingInvitationDto[]> {
    return this.usersService.listPendingInvitations(authCtx);
  }

  // POST /users/invite — owner|admin invites a new admin. 201 because the
  // resource being created is an Invitation row.
  @Post("invite")
  @HttpCode(201)
  async invite(
    @Body(new ZodValidationPipe(inviteAdminSchema)) dto: InviteAdminInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<InviteAdminResponse> {
    return this.usersService.invite(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
