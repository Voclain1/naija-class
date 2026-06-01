import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  bulkCreateEnrollmentSchema,
  createEnrollmentSchema,
  listEnrollmentsQuerySchema,
  updateEnrollmentSchema,
  type BulkCreateEnrollmentInput,
  type BulkEnrollmentResponse,
  type CreateEnrollmentInput,
  type EnrollmentDto,
  type EnrollmentListResponse,
  type ListEnrollmentsQuery,
  type UpdateEnrollmentInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { EnrollmentsService } from "./enrollments.service";

@Controller("enrollments")
@UseGuards(AuthGuard, PermissionsGuard)
export class EnrollmentsController {
  constructor(private readonly service: EnrollmentsService) {}

  @Get()
  @Permissions("enrollment.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listEnrollmentsQuerySchema))
    query: ListEnrollmentsQuery,
  ): Promise<EnrollmentListResponse> {
    return this.service.list(authCtx, query);
  }

  @Get(":id")
  @Permissions("enrollment.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<EnrollmentDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("enrollment.create")
  async create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createEnrollmentSchema))
    dto: CreateEnrollmentInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<EnrollmentDto> {
    return this.service.create(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // POST /enrollments/bulk — term-roll carry-over. Same idempotent
  // contract as slice 7's commit handler: re-running with the same
  // payload is safe (already-enrolled rows are counted in `skipped`).
  @Post("bulk")
  @HttpCode(201)
  @Permissions("enrollment.create")
  async bulkCreate(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(bulkCreateEnrollmentSchema))
    dto: BulkCreateEnrollmentInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<BulkEnrollmentResponse> {
    return this.service.bulkCreate(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Patch(":id")
  @Permissions("enrollment.update")
  async update(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateEnrollmentSchema))
    dto: UpdateEnrollmentInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<EnrollmentDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // Owner-only: enrollment is history-bearing (see OWNER_ONLY_PERMISSIONS).
  // admin lacks enrollment.delete, so the guard rejects admin here.
  @Delete(":id")
  @HttpCode(204)
  @Permissions("enrollment.delete")
  async delete(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.delete(authCtx, id, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
