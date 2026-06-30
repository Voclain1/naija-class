import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  createDiscountRuleSchema,
  updateDiscountRuleSchema,
  type CreateDiscountRuleInput,
  type DiscountRuleDto,
  type UpdateDiscountRuleInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { DiscountRuleService } from "./discount-rule.service.js";

@Controller("discount-rules")
@UseGuards(AuthGuard, PermissionsGuard)
export class DiscountRulesController {
  constructor(private readonly service: DiscountRuleService) {}

  @Get()
  @Permissions("discount-rule.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query("studentId") studentId?: string,
    @Query("feeItemId") feeItemId?: string,
    @Query("feeCategoryId") feeCategoryId?: string,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<DiscountRuleDto[]> {
    return this.service.findAll(authCtx, {
      studentId,
      feeItemId,
      feeCategoryId,
      includeInactive: includeInactive === "true",
    });
  }

  @Get(":id")
  @Permissions("discount-rule.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<DiscountRuleDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("discount-rule.create")
  async create(
    @Body(new ZodValidationPipe(createDiscountRuleSchema)) dto: CreateDiscountRuleInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<DiscountRuleDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Patch(":id")
  @Permissions("discount-rule.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDiscountRuleSchema)) dto: UpdateDiscountRuleInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<DiscountRuleDto> {
    return this.service.update(authCtx, id, dto, { ipAddress: ip });
  }

  // DELETE deactivates (sets active=false) — row preserved for audit trail and
  // invoice history. Permission is discount-rule.deactivate, not .delete.
  @Delete(":id")
  @HttpCode(204)
  @Permissions("discount-rule.deactivate")
  async deactivate(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.deactivate(authCtx, id, { ipAddress: ip });
  }
}
