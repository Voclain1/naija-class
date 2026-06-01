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
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  createClassArmSchema,
  updateClassArmSchema,
  type ClassArmDto,
  type CreateClassArmInput,
  type UpdateClassArmInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ClassArmsService } from "./class-arms.service";

// ClassArmsController has NO class-level prefix on purpose: it owns BOTH
// the nested URLs (/class-levels/:levelId/class-arms) AND the flat URLs
// (/class-arms/:id). Matches the slice-1 TermsController pattern —
// nested-create + flat-edit. See terms.controller.ts header.
@Controller()
@UseGuards(AuthGuard, PermissionsGuard)
export class ClassArmsController {
  constructor(private readonly service: ClassArmsService) {}

  // -----------------------------------------------------------------------
  // nested under a class level
  // -----------------------------------------------------------------------

  @Get("class-levels/:levelId/class-arms")
  @Permissions("class-arm.read")
  async listForLevel(
    @CurrentUser() authCtx: AuthContext,
    @Param("levelId") levelId: string,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<ClassArmDto[]> {
    return this.service.listForLevel(authCtx, levelId, {
      includeInactive: includeInactive === "true",
    });
  }

  @Post("class-levels/:levelId/class-arms")
  @HttpCode(201)
  @Permissions("class-arm.create")
  async create(
    @Param("levelId") levelId: string,
    @Body(new ZodValidationPipe(createClassArmSchema)) dto: CreateClassArmInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ClassArmDto> {
    return this.service.create(authCtx, levelId, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // -----------------------------------------------------------------------
  // flat (cross-level)
  // -----------------------------------------------------------------------

  @Get("class-arms")
  @Permissions("class-arm.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<ClassArmDto[]> {
    return this.service.list(authCtx, {
      includeInactive: includeInactive === "true",
    });
  }

  @Get("class-arms/:id")
  @Permissions("class-arm.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<ClassArmDto> {
    return this.service.findById(authCtx, id);
  }

  @Patch("class-arms/:id")
  @Permissions("class-arm.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClassArmSchema)) dto: UpdateClassArmInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ClassArmDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Delete("class-arms/:id")
  @HttpCode(204)
  @Permissions("class-arm.delete")
  async delete(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.delete(authCtx, id, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
