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
  createFeeItemSchema,
  updateFeeItemSchema,
  type CreateFeeItemInput,
  type FeeItemDto,
  type UpdateFeeItemInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { FeeItemService } from "./fee-item.service.js";

@Controller("fee-items")
@UseGuards(AuthGuard, PermissionsGuard)
export class FeeItemsController {
  constructor(private readonly service: FeeItemService) {}

  @Get()
  @Permissions("fee-item.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query("categoryId") categoryId?: string,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<FeeItemDto[]> {
    return this.service.findAll(authCtx, {
      categoryId,
      includeInactive: includeInactive === "true",
    });
  }

  @Get(":id")
  @Permissions("fee-item.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<FeeItemDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("fee-item.create")
  async create(
    @Body(new ZodValidationPipe(createFeeItemSchema)) dto: CreateFeeItemInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<FeeItemDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Patch(":id")
  @Permissions("fee-item.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateFeeItemSchema)) dto: UpdateFeeItemInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<FeeItemDto> {
    return this.service.update(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete(":id")
  @HttpCode(204)
  @Permissions("fee-item.delete")
  async delete(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.delete(authCtx, id, { ipAddress: ip });
  }
}
