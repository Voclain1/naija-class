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
  createTeacherProfileSchema,
  listTeacherProfilesQuerySchema,
  updateMyTeacherProfileSchema,
  updateTeacherProfileSchema,
  type CreateTeacherProfileInput,
  type ListTeacherProfilesQuery,
  type TeacherProfileDto,
  type TeacherProfileListResponse,
  type UpdateMyTeacherProfileInput,
  type UpdateTeacherProfileInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { TeacherProfilesService } from "./teacher-profiles.service";

@Controller("teacher-profiles")
@UseGuards(AuthGuard, PermissionsGuard)
export class TeacherProfilesController {
  constructor(private readonly service: TeacherProfilesService) {}

  // ---- Self-service (teacher's own profile) --------------------------
  // Declared BEFORE the ":id" routes so "me" is matched as the literal
  // segment, not captured by the @Get(":id") param route.
  // Gated by the self-service permissions the teacher role holds.

  @Get("me")
  @Permissions("teacher-profile.self.read")
  async getMine(
    @CurrentUser() authCtx: AuthContext,
  ): Promise<TeacherProfileDto> {
    return this.service.getMine(authCtx);
  }

  @Patch("me")
  @Permissions("teacher-profile.self.update")
  async updateMine(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(updateMyTeacherProfileSchema))
    dto: UpdateMyTeacherProfileInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<TeacherProfileDto> {
    return this.service.updateMine(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // ---- Admin CRUD ----------------------------------------------------

  @Get()
  @Permissions("teacher-profile.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listTeacherProfilesQuerySchema))
    query: ListTeacherProfilesQuery,
  ): Promise<TeacherProfileListResponse> {
    return this.service.list(authCtx, query);
  }

  @Get(":id")
  @Permissions("teacher-profile.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<TeacherProfileDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("teacher-profile.create")
  async create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createTeacherProfileSchema))
    dto: CreateTeacherProfileInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<TeacherProfileDto> {
    return this.service.create(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Patch(":id")
  @Permissions("teacher-profile.update")
  async update(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateTeacherProfileSchema))
    dto: UpdateTeacherProfileInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<TeacherProfileDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @Permissions("teacher-profile.delete")
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
