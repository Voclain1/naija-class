import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import {
  createRefundSchema,
  type CreateRefundInput,
  type RefundDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { RefundsService } from "./refunds.service.js";

@Controller("refunds")
@UseGuards(AuthGuard, PermissionsGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post()
  @HttpCode(201)
  @Permissions("payment.refund")
  create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createRefundSchema)) dto: CreateRefundInput,
  ): Promise<RefundDto> {
    return this.refunds.create(authCtx, dto);
  }
}
