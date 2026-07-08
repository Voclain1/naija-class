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
  createExpenseCategorySchema,
  updateExpenseCategorySchema,
  type CreateExpenseCategoryInput,
  type ExpenseCategoryDto,
  type UpdateExpenseCategoryInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ExpenseCategoryService } from "./expense-category.service.js";

@Controller("expense-categories")
@UseGuards(AuthGuard, PermissionsGuard)
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoryService) {}

  @Get()
  @Permissions("expense-category.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<ExpenseCategoryDto[]> {
    return this.service.findAll(authCtx, { includeInactive: includeInactive === "true" });
  }

  @Get(":id")
  @Permissions("expense-category.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<ExpenseCategoryDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("expense-category.create")
  async create(
    @Body(new ZodValidationPipe(createExpenseCategorySchema)) dto: CreateExpenseCategoryInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<ExpenseCategoryDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Patch(":id")
  @Permissions("expense-category.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateExpenseCategorySchema)) dto: UpdateExpenseCategoryInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<ExpenseCategoryDto> {
    return this.service.update(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete(":id")
  @HttpCode(204)
  @Permissions("expense-category.delete")
  async delete(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.delete(authCtx, id, { ipAddress: ip });
  }
}
