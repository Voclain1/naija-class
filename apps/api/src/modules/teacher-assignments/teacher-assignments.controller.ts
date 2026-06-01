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
  createTeacherAssignmentSchema,
  listTeacherAssignmentsQuerySchema,
  updateTeacherAssignmentSchema,
  type CreateTeacherAssignmentInput,
  type ListTeacherAssignmentsQuery,
  type TeacherAssignmentDto,
  type TeacherAssignmentListResponse,
  type UpdateTeacherAssignmentInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { TeacherAssignmentsService } from "./teacher-assignments.service";

// Admin CRUD for teacher assignments. Every route is gated owner|admin in the
// service layer via assertUserActiveAndHasOneOf (defense-in-depth) plus the
// @Permissions guard. A teacher's own scoped read view is a SEPARATE dedicated
// endpoint (teacher-scope), so this controller never branches on teacher scope.
@Controller("teacher-assignments")
@UseGuards(AuthGuard, PermissionsGuard)
export class TeacherAssignmentsController {
  constructor(private readonly service: TeacherAssignmentsService) {}

  @Get()
  @Permissions("teacher-assignment.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listTeacherAssignmentsQuerySchema))
    query: ListTeacherAssignmentsQuery,
  ): Promise<TeacherAssignmentListResponse> {
    return this.service.list(authCtx, query);
  }

  @Get(":id")
  @Permissions("teacher-assignment.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<TeacherAssignmentDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("teacher-assignment.create")
  async create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createTeacherAssignmentSchema))
    dto: CreateTeacherAssignmentInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<TeacherAssignmentDto> {
    return this.service.create(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Patch(":id")
  @Permissions("teacher-assignment.update")
  async update(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateTeacherAssignmentSchema))
    dto: UpdateTeacherAssignmentInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<TeacherAssignmentDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @Permissions("teacher-assignment.delete")
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
