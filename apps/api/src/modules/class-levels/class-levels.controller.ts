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
  createClassLevelSchema,
  updateClassLevelSchema,
  type ClassLevelDto,
  type CreateClassLevelInput,
  type UpdateClassLevelInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ClassLevelsService } from "./class-levels.service";

@Controller("class-levels")
@UseGuards(AuthGuard)
export class ClassLevelsController {
  constructor(private readonly service: ClassLevelsService) {}

  @Get()
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<ClassLevelDto[]> {
    return this.service.list(authCtx, {
      includeInactive: includeInactive === "true",
    });
  }

  @Get(":id")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<ClassLevelDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createClassLevelSchema)) dto: CreateClassLevelInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ClassLevelDto> {
    return this.service.create(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClassLevelSchema)) dto: UpdateClassLevelInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ClassLevelDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Delete(":id")
  @HttpCode(204)
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
