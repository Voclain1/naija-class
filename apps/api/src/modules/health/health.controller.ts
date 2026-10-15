import { Body, Controller, Get, Ip, Param, Put, Query, UseGuards } from "@nestjs/common";

import {
  healthStudentListQuerySchema,
  updateHealthProfileSchema,
  type HealthProfileDto,
  type HealthStudentListQuery,
  type HealthStudentListResponse,
  type TeacherHealthNoteForStudentDto,
  type TeacherHealthNotesResponse,
  type UpdateHealthProfileInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { HealthService } from "./health.service.js";

// Phase 9 / CP3.1 — health profiles, staff side (docs/modules/phase-9.md §10).
// The record routes need health.read / health.manage (owner, admin, Health
// officer). The teacher-note routes need health.note.read and return the
// "For teachers" note only; the service holds a teacher to their own classes.
@Controller("health")
@UseGuards(AuthGuard, PermissionsGuard)
export class HealthController {
  constructor(private readonly service: HealthService) {}

  @Get("students")
  @Permissions("health.read")
  async listStudents(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(healthStudentListQuerySchema)) query: HealthStudentListQuery,
  ): Promise<HealthStudentListResponse> {
    return this.service.listStudents(authCtx, query);
  }

  @Get("students/:id")
  @Permissions("health.read")
  async getProfile(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<HealthProfileDto> {
    return this.service.getProfile(authCtx, id, { ipAddress: ip });
  }

  @Put("students/:id")
  @Permissions("health.manage")
  async updateProfile(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateHealthProfileSchema)) dto: UpdateHealthProfileInput,
    @Ip() ip: string,
  ): Promise<HealthProfileDto> {
    return this.service.updateProfile(authCtx, id, dto, { ipAddress: ip });
  }

  @Get("teacher-notes")
  @Permissions("health.note.read")
  async teacherNotes(
    @CurrentUser() authCtx: AuthContext,
    @Query("armId") armId: string,
    @Ip() ip: string,
  ): Promise<TeacherHealthNotesResponse> {
    return this.service.teacherNotesForArm(authCtx, armId, { ipAddress: ip });
  }

  @Get("teacher-notes/students/:id")
  @Permissions("health.note.read")
  async teacherNote(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<TeacherHealthNoteForStudentDto> {
    return this.service.teacherNoteForStudent(authCtx, id, { ipAddress: ip });
  }
}
