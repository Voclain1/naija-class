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
  createSubjectSchema,
  updateSubjectSchema,
  type CreateSubjectInput,
  type SubjectDto,
  type UpdateSubjectInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { SubjectsService } from "./subjects.service";

// Subject is a school-scoped root catalogue entry — flat CRUD only.
// Matches the academic-years pattern (slice 1) and class-levels (slice 2).
@Controller("subjects")
@UseGuards(AuthGuard, PermissionsGuard)
export class SubjectsController {
  constructor(private readonly service: SubjectsService) {}

  @Get()
  @Permissions("subject.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<SubjectDto[]> {
    return this.service.list(authCtx, {
      includeInactive: includeInactive === "true",
    });
  }

  @Get(":id")
  @Permissions("subject.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<SubjectDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("subject.create")
  async create(
    @Body(new ZodValidationPipe(createSubjectSchema)) dto: CreateSubjectInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SubjectDto> {
    return this.service.create(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Patch(":id")
  @Permissions("subject.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSubjectSchema)) dto: UpdateSubjectInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SubjectDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @Permissions("subject.delete")
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
