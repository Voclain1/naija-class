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
  type SignupOwnerUserDto,
  type UserListItemDto,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { UsersService } from "./users.service";

// UsersController is Phase 0 code and was never retrofitted with the
// PermissionsGuard/@Permissions pattern the Phase 1 slice-13 rollup applied
// elsewhere — permissions-coverage.spec.ts's PHASE_1_CONTROLLERS sweep
// explicitly carves Phase 0 controllers out as a deliberate deferral, and
// list()/listInvitations() relied solely on the service-layer
// assertUserActiveAndHasOneOf(['owner','admin']) check for authorization.
// That service check was never actually bypassable (it throws before any
// query runs), so this was a defense-in-depth gap, not a live data leak —
// but it's the only module still on the old single-gate pattern, so add the
// guard here too, mirroring BvnController's mixed wiring (method-level
// @UseGuards(PermissionsGuard) only on the routes that need it, since
// PermissionsGuard fails closed and invite()/completeTour() intentionally
// don't carry @Permissions yet). Reuses the pre-existing `user.read`
// permission (PHASE_0_PERMISSIONS) — already granted to owner (wildcard) and
// admin only, never teacher/bursar, so no seed change was needed. The
// service-layer assert stays as the second independent gate, per
// permissions.guard.ts's documented two-gate convention.
@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /users — list users in the current school (excluding self).
  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions("user.read")
  async list(@CurrentUser() authCtx: AuthContext): Promise<UserListItemDto[]> {
    return this.usersService.listUsers(authCtx);
  }

  // GET /users/invitations — list pending (not accepted, not expired)
  // invitations for the current school.
  @Get("invitations")
  @UseGuards(PermissionsGuard)
  @Permissions("user.read")
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

  // POST /users/me/complete-tour — any authenticated user marks the
  // first-login product tour finished or skipped (both call this; there is
  // no separate "skipped" state — see User.tourCompletedAt's schema
  // comment). Idempotent: calling it again just re-stamps "now".
  @Post("me/complete-tour")
  async completeTour(@CurrentUser() authCtx: AuthContext): Promise<SignupOwnerUserDto> {
    return this.usersService.completeTour(authCtx);
  }
}
