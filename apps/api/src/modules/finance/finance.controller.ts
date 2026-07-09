import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import {
  financeDashboardQuerySchema,
  listDebtorsSchema,
  sendRemindersSchema,
  type DebtorDto,
  type FinanceDashboardDto,
  type FinanceDashboardQuery,
  type ListDebtorsInput,
  type SendRemindersInput,
  type SendRemindersResult,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { FinanceService } from "./finance.service.js";

@Controller("finance")
@UseGuards(AuthGuard, PermissionsGuard)
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  // ─── GET /finance/debtors?termId= ────────────────────────────────────────

  @Get("debtors")
  @Permissions("finance.debtors.read")
  async listDebtors(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listDebtorsSchema)) query: ListDebtorsInput,
  ): Promise<DebtorDto[]> {
    return this.service.listDebtors(authCtx, query.termId);
  }

  // ─── POST /finance/debtors/remind ────────────────────────────────────────

  @Post("debtors/remind")
  @HttpCode(200)
  @Permissions("finance.debtors.remind")
  async sendReminders(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(sendRemindersSchema)) dto: SendRemindersInput,
  ): Promise<SendRemindersResult> {
    return this.service.sendReminders(authCtx, dto);
  }

  // ─── GET /finance/dashboard?termId= ───────────────────────────────────────

  @Get("dashboard")
  @Permissions("finance.dashboard.read")
  async getDashboard(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(financeDashboardQuerySchema)) query: FinanceDashboardQuery,
  ): Promise<FinanceDashboardDto> {
    return this.service.getDashboard(authCtx, query.termId);
  }
}
