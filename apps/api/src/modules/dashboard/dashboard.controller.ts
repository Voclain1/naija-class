import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  adminDashboardQuerySchema,
  type AdminDashboardDto,
  type AdminDashboardQuery,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { DashboardService } from "./dashboard.service.js";

@Controller("dashboard")
@UseGuards(AuthGuard, PermissionsGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // ─── GET /dashboard?termId= ───────────────────────────────────────────────

  @Get()
  @Permissions("dashboard.read")
  async getAdminDashboard(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(adminDashboardQuerySchema)) query: AdminDashboardQuery,
  ): Promise<AdminDashboardDto> {
    return this.service.getAdminDashboard(authCtx, query.termId);
  }
}
