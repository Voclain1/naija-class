import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  createSubjectHideSchema,
  listSubjectHidesSchema,
  type CreateSubjectHideInput,
  type ListSubjectHidesInput,
  type SubjectHideDto,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { SubjectHidesService } from "./subject-hides.service";

// Hidden subjects (2026-11-02, docs/modules/subjects-by-class.md). Gated on
// assessment.aggregate, which owners, admins and teachers hold; the service
// then limits a teacher to the arm they are form teacher of.
@Controller("subject-hides")
@UseGuards(AuthGuard, PermissionsGuard)
export class SubjectHidesController {
  constructor(private readonly service: SubjectHidesService) {}

  @Get()
  @Permissions("assessment.aggregate")
  list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listSubjectHidesSchema)) query: ListSubjectHidesInput,
  ): Promise<SubjectHideDto[]> {
    return this.service.list(authCtx, query);
  }

  @Post()
  @HttpCode(201)
  @Permissions("assessment.aggregate")
  create(
    @Body(new ZodValidationPipe(createSubjectHideSchema)) dto: CreateSubjectHideInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SubjectHideDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  @Post(":id/unhide")
  @HttpCode(200)
  @Permissions("assessment.aggregate")
  unhide(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SubjectHideDto> {
    return this.service.unhide(authCtx, id, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }
}
