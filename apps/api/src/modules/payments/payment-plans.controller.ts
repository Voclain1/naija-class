import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  createPaymentPlanSchema,
  type CreatePaymentPlanInput,
  type PaymentPlanDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { PaymentPlanService } from "./payment-plan.service.js";

// Route ordering: static sub-paths ("invoice/:invoiceId") must come before the
// dynamic catch-all ("/:id") so NestJS does not greedily capture "invoice" as
// an id parameter.

@Controller("payment-plans")
@UseGuards(AuthGuard, PermissionsGuard)
export class PaymentPlansController {
  constructor(private readonly service: PaymentPlanService) {}

  // ─── GET /payment-plans/invoice/:invoiceId ────────────────────────────────

  @Get("invoice/:invoiceId")
  @Permissions("payment-plan.read")
  async findByInvoice(
    @CurrentUser() authCtx: AuthContext,
    @Param("invoiceId") invoiceId: string,
  ): Promise<PaymentPlanDto | null> {
    return this.service.findByInvoice(authCtx, invoiceId);
  }

  // ─── POST /payment-plans ──────────────────────────────────────────────────

  @Post()
  @HttpCode(201)
  @Permissions("payment-plan.create")
  async create(
    @Body(new ZodValidationPipe(createPaymentPlanSchema)) dto: CreatePaymentPlanInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<PaymentPlanDto> {
    return this.service.create(authCtx, dto);
  }

  // ─── DELETE /payment-plans/:id ────────────────────────────────────────────

  @Delete(":id")
  @HttpCode(204)
  @Permissions("payment-plan.delete")
  async delete(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<void> {
    return this.service.delete(authCtx, id);
  }
}
