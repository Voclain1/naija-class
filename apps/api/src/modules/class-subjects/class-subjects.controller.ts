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
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  bulkClassSubjectsSchema,
  createClassSubjectSchema,
  updateClassSubjectSchema,
  type BulkClassSubjectsInput,
  type ClassSubjectDto,
  type CreateClassSubjectInput,
  type UpdateClassSubjectInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ClassSubjectsService } from "./class-subjects.service";

// No class-level prefix — owns BOTH the nested URLs
// (/class-levels/:levelId/class-subjects[/bulk]) AND the flat URLs
// (/class-subjects/:id). Mirrors TermsController + ClassArmsController.
@Controller()
@UseGuards(AuthGuard)
export class ClassSubjectsController {
  constructor(private readonly service: ClassSubjectsService) {}

  // -----------------------------------------------------------------------
  // nested under a class level
  // -----------------------------------------------------------------------

  @Get("class-levels/:levelId/class-subjects")
  async listForLevel(
    @CurrentUser() authCtx: AuthContext,
    @Param("levelId") levelId: string,
  ): Promise<ClassSubjectDto[]> {
    return this.service.listForLevel(authCtx, levelId);
  }

  @Post("class-levels/:levelId/class-subjects")
  @HttpCode(201)
  async create(
    @Param("levelId") levelId: string,
    @Body(new ZodValidationPipe(createClassSubjectSchema)) dto: CreateClassSubjectInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ClassSubjectDto> {
    return this.service.create(authCtx, levelId, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Post("class-levels/:levelId/class-subjects/bulk")
  @HttpCode(200)
  async bulk(
    @Param("levelId") levelId: string,
    @Body(new ZodValidationPipe(bulkClassSubjectsSchema)) dto: BulkClassSubjectsInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ClassSubjectDto[]> {
    return this.service.bulk(authCtx, levelId, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // -----------------------------------------------------------------------
  // flat by id
  // -----------------------------------------------------------------------

  @Get("class-subjects/:id")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<ClassSubjectDto> {
    return this.service.findById(authCtx, id);
  }

  @Patch("class-subjects/:id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClassSubjectSchema)) dto: UpdateClassSubjectInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ClassSubjectDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Delete("class-subjects/:id")
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
