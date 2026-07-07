import { Body, Controller, Get, HttpCode, Param, Patch, UseGuards } from "@nestjs/common";

import {
  captureBvnSchema,
  type BvnRevealDto,
  type BvnStatusDto,
  type CaptureBvnInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { BvnService } from "./bvn.service.js";

// Phase 3 / Slice 12 — BVN capture/reveal. The /me routes need no
// @Permissions string beyond authentication — every user manages their own
// BVN regardless of role. The /:id routes (admin/owner acting on another
// staff member's BVN) are permission-gated; bursar is excluded from all
// three (mirrors payment.refund — the highest-trust surface in payroll).
//
// Declaration order matters: "me" is a static segment and must be declared
// before ":id" routes so Nest doesn't capture the literal string "me" as an
// :id parameter (same discipline as payment-plans.controller.ts).
@Controller("users")
@UseGuards(AuthGuard)
export class BvnController {
  constructor(private readonly bvn: BvnService) {}

  @Patch("me/bvn")
  @HttpCode(204)
  async captureOwnBvn(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(captureBvnSchema)) dto: CaptureBvnInput,
  ): Promise<void> {
    await this.bvn.captureBvn(authCtx, authCtx.userId, dto);
  }

  @Get("me/bvn")
  getOwnBvnStatus(@CurrentUser() authCtx: AuthContext): Promise<BvnStatusDto> {
    return this.bvn.getBvnStatus(authCtx, authCtx.userId);
  }

  @Get("me/bvn/reveal")
  revealOwnBvn(@CurrentUser() authCtx: AuthContext): Promise<BvnRevealDto> {
    return this.bvn.revealBvn(authCtx, authCtx.userId);
  }

  @Patch(":id/bvn")
  @HttpCode(204)
  @UseGuards(PermissionsGuard)
  @Permissions("staff-bvn.manage-others")
  async captureBvnForStaff(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(captureBvnSchema)) dto: CaptureBvnInput,
  ): Promise<void> {
    await this.bvn.captureBvn(authCtx, id, dto);
  }

  @Get(":id/bvn")
  @UseGuards(PermissionsGuard)
  @Permissions("staff-bvn.read")
  getBvnStatusForStaff(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<BvnStatusDto> {
    return this.bvn.getBvnStatus(authCtx, id);
  }

  @Get(":id/bvn/reveal")
  @UseGuards(PermissionsGuard)
  @Permissions("staff-bvn.reveal")
  revealBvnForStaff(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<BvnRevealDto> {
    return this.bvn.revealBvn(authCtx, id);
  }
}
