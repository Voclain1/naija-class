import { Body, Controller, Get, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  listParentSummariesSchema,
  updateParentSummarySettingsSchema,
  type ListParentSummariesInput,
  type ParentSummaryRowDto,
  type ParentSummarySettingsDto,
  type UpdateParentSummarySettingsInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ParentSummariesService } from "./parent-summaries.service.js";

// Staff-facing surface for a feature whose actual audience is parents.
//
// The permission split is the point (D16): `parent-summary.read` is held by
// teachers too — a form teacher fielding "the school said my child was late
// twice" needs to read the note the parent is holding — while
// `parent-summary.manage` is admin/owner only, because it is the switch that
// decides whether unattended AI output reaches parents at all.
//
// Route order note: `settings` is declared before any dynamic segment would
// be, so a future GET /parent-summaries/:id cannot swallow it. Same
// discipline as the finance controllers' static-before-dynamic ordering.
@Controller("parent-summaries")
@UseGuards(AuthGuard, PermissionsGuard)
export class ParentSummariesController {
  constructor(private readonly service: ParentSummariesService) {}

  @Get()
  @Permissions("parent-summary.read")
  async list(
    @Query(new ZodValidationPipe(listParentSummariesSchema)) query: ListParentSummariesInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<ParentSummaryRowDto[]> {
    return this.service.list(authCtx, query);
  }

  @Get("settings")
  @Permissions("parent-summary.manage")
  async getSettings(@CurrentUser() authCtx: AuthContext): Promise<ParentSummarySettingsDto> {
    return this.service.getSettings(authCtx);
  }

  @Patch("settings")
  @Permissions("parent-summary.manage")
  async updateSettings(
    @Body(new ZodValidationPipe(updateParentSummarySettingsSchema))
    body: UpdateParentSummarySettingsInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<ParentSummarySettingsDto> {
    return this.service.updateSettings(authCtx, body.enabled);
  }

  // Manual re-run of the current week. The "we just switched it on, show me
  // what it writes" path — which, given there is no approval gate, is the
  // closest thing to a preview a school gets before parents see the output.
  // Deliberately does NOT bypass the opt-in; the service refuses when the
  // feature is off.
  @Post("run")
  @Permissions("parent-summary.manage")
  async run(@CurrentUser() authCtx: AuthContext): Promise<{ queued: number }> {
    return this.service.triggerNow(authCtx);
  }
}
