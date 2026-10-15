import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import {
  ValidationError,
  createVaccinationSchema,
  healthStudentListQuerySchema,
  type CreateVaccinationInput,
  type HealthDocumentUrlDto,
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
import { PRIVATE_FILE_MAX_BYTES } from "../../common/storage/private-file.js";
import { UploadErrorFilter } from "../../common/upload-error.filter.js";
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

  // -------------------------------------------------------------------------
  // Phase 9 / CP3.2 — vaccinations and their documents (F1). Writing is
  // health.manage, reading health.read, as for the profile.
  // -------------------------------------------------------------------------

  @Post("students/:id/vaccinations")
  @HttpCode(201)
  @Permissions("health.manage")
  async createVaccination(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createVaccinationSchema)) dto: CreateVaccinationInput,
    @Ip() ip: string,
  ): Promise<HealthProfileDto> {
    return this.service.createVaccination(authCtx, id, dto, { ipAddress: ip });
  }

  @Post("vaccinations/:id/withdraw")
  @HttpCode(200)
  @Permissions("health.manage")
  async withdrawVaccination(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<HealthProfileDto> {
    return this.service.withdrawVaccination(authCtx, id, { ipAddress: ip });
  }

  @Post("vaccinations/:id/document")
  @HttpCode(200)
  @Permissions("health.manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PRIVATE_FILE_MAX_BYTES } }))
  @UseFilters(new UploadErrorFilter("10 MB"))
  async uploadDocument(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
  ): Promise<HealthProfileDto> {
    if (!file) {
      throw new ValidationError("INVALID_UPLOAD", "No file uploaded. Use multipart/form-data with a 'file' field.");
    }
    return this.service.uploadDocument(authCtx, id, { buffer: file.buffer }, { ipAddress: ip });
  }

  @Get("vaccinations/:id/document")
  @Permissions("health.read")
  async documentUrl(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<HealthDocumentUrlDto> {
    return this.service.documentUrl(authCtx, id, { ipAddress: ip });
  }
}
