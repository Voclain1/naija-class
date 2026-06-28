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
  createFeeCategorySchema,
  updateFeeCategorySchema,
  type CreateFeeCategoryInput,
  type FeeCategoryDto,
  type UpdateFeeCategoryInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { FeeCategoryService } from "./fee-category.service.js";

@Controller("fee-categories")
@UseGuards(AuthGuard, PermissionsGuard)
export class FeeCategoriesController {
  constructor(private readonly service: FeeCategoryService) {}

  @Get()
  @Permissions("fee-category.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<FeeCategoryDto[]> {
    return this.service.findAll(authCtx, {
      includeInactive: includeInactive === "true",
    });
  }

  @Get(":id")
  @Permissions("fee-category.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<FeeCategoryDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("fee-category.create")
  async create(
    @Body(new ZodValidationPipe(createFeeCategorySchema)) dto: CreateFeeCategoryInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<FeeCategoryDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Patch(":id")
  @Permissions("fee-category.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateFeeCategorySchema)) dto: UpdateFeeCategoryInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<FeeCategoryDto> {
    return this.service.update(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete(":id")
  @HttpCode(204)
  @Permissions("fee-category.delete")
  async delete(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.delete(authCtx, id, { ipAddress: ip });
  }
}
