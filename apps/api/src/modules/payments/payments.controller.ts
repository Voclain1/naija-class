import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  listPaymentsSchema,
  recordManualPaymentSchema,
  type ListPaymentsInput,
  type PaginatedPaymentsDto,
  type PaymentDto,
  type PaymentReceiptUrlDto,
  type RecordManualPaymentInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { PaymentsService } from "./payments.service.js";

@Controller("payments")
@UseGuards(AuthGuard, PermissionsGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  // ─── Static sub-paths first (before /:id) ─────────────────────────────────
  // "manual" must be declared before ":id" so NestJS does not capture the
  // literal string "manual" as an ID parameter.

  @Get()
  @Permissions("payment.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listPaymentsSchema)) query: ListPaymentsInput,
  ): Promise<PaginatedPaymentsDto> {
    return this.service.findAll(authCtx, query);
  }

  @Post("manual")
  @HttpCode(201)
  @Permissions("payment.record")
  async recordManual(
    @Body(new ZodValidationPipe(recordManualPaymentSchema)) dto: RecordManualPaymentInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<PaymentDto> {
    return this.service.recordManual(authCtx, dto, { ipAddress: ip });
  }

  // ─── Dynamic routes ────────────────────────────────────────────────────────

  @Get(":id")
  @Permissions("payment.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<PaymentDto> {
    return this.service.findById(authCtx, id);
  }

  @Get(":id/receipt")
  @Permissions("payment.read")
  async getReceiptUrl(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<PaymentReceiptUrlDto> {
    return this.service.getReceiptUrl(authCtx, id);
  }
}
