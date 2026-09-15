import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  copyPreviewQuerySchema,
  copyTimetableSchema,
  forkTimetableSchema,
  withdrawPublicationSchema,
  type CopyResultDto,
  type CopyTimetableInput,
  type ForkTimetableInput,
  type PublishResultDto,
  type TimetableClashDto,
  type WithdrawPublicationInput,
  clearLessonSchema,
  createTimetableSchema,
  saveBellScheduleSchema,
  saveLessonSchema,
  timetableQuerySchema,
  type BellScheduleDto,
  type ClearLessonInput,
  type CreateTimetableInput,
  type LessonDto,
  type SaveBellScheduleInput,
  type SaveLessonInput,
  type SaveLessonResultDto,
  type TimetableHeaderDto,
  type TimetableOptionsDto,
  type TimetableQuery,
  type TimetableViewDto,
} from "@school-kit/types";
import { z } from "zod";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { TimetableService } from "./timetable.service.js";

// Phase 8 / CP3 — Timetable builder. docs/modules/phase-8.md §17 D35–D36.
//
// Owner/admin only in CP3: timetable.read and timetable.manage are granted to
// admin (owner is the wildcard) and to no other role. Every mutation re-asserts
// owner/admin and isActive in the service (two gates).
@Controller("timetable")
@UseGuards(AuthGuard, PermissionsGuard)
export class TimetableController {
  constructor(private readonly service: TimetableService) {}

  @Get("bell-schedule")
  @Permissions("timetable.read")
  async bellSchedule(@CurrentUser() authCtx: AuthContext): Promise<BellScheduleDto> {
    return this.service.getBellSchedule(authCtx);
  }

  @Put("bell-schedule")
  @Permissions("timetable.manage")
  async saveBellSchedule(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(saveBellScheduleSchema)) input: SaveBellScheduleInput,
    @Ip() ip: string,
  ): Promise<BellScheduleDto> {
    return this.service.saveBellSchedule(authCtx, input, { ipAddress: ip });
  }

  @Get("options")
  @Permissions("timetable.read")
  async options(@CurrentUser() authCtx: AuthContext): Promise<TimetableOptionsDto> {
    return this.service.getOptions(authCtx);
  }

  // GET /timetable/view?classArmId=&termId= — the timetable in force for a class in a term.
  @Get("view")
  @Permissions("timetable.read")
  async view(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(timetableQuerySchema)) query: TimetableQuery,
  ): Promise<TimetableViewDto> {
    return this.service.getView(authCtx, query);
  }

  @Post("timetables")
  @HttpCode(201)
  @Permissions("timetable.manage")
  async createTimetable(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createTimetableSchema)) input: CreateTimetableInput,
    @Ip() ip: string,
  ): Promise<TimetableHeaderDto> {
    return this.service.createTimetable(authCtx, input, { ipAddress: ip });
  }

  @Delete("timetables/:id")
  @HttpCode(204)
  @Permissions("timetable.manage")
  async deleteTimetable(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.deleteTimetable(authCtx, id, { ipAddress: ip });
  }

  @Put("lessons")
  @Permissions("timetable.manage")
  async saveLesson(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(saveLessonSchema)) input: SaveLessonInput,
    @Ip() ip: string,
  ): Promise<SaveLessonResultDto> {
    return this.service.saveLesson(authCtx, input, { ipAddress: ip });
  }

  @Post("lessons/clear")
  @HttpCode(200)
  @Permissions("timetable.manage")
  async clearLesson(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(clearLessonSchema)) input: ClearLessonInput,
    @Ip() ip: string,
  ): Promise<LessonDto[]> {
    return this.service.clearLesson(authCtx, input, { ipAddress: ip });
  }

  // ---------------------------------------------------------------------------
  // CP4 (§18) — clash banner, fork, copy, publish, withdraw
  // ---------------------------------------------------------------------------

  // GET /timetable/clashes?academicYearId= — every clash in force in a year (D43 banner).
  @Get("clashes")
  @Permissions("timetable.read")
  async clashes(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(z.object({ academicYearId: z.string().uuid() }))) query: { academicYearId: string },
  ): Promise<TimetableClashDto[]> {
    return this.service.getYearClashes(authCtx, query.academicYearId);
  }

  // POST /timetable/timetables/:id/fork[?preview=true] — whole-year → term override, lessons copied (D41).
  @Post("timetables/:id/fork")
  @HttpCode(200)
  @Permissions("timetable.manage")
  async fork(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(forkTimetableSchema)) input: ForkTimetableInput,
    @Query(new ZodValidationPipe(copyPreviewQuerySchema)) query: { preview?: "true" | "false" },
    @Ip() ip: string,
  ): Promise<CopyResultDto> {
    return this.service.forkTimetable(authCtx, id, input, { ipAddress: ip }, { preview: query.preview === "true" });
  }

  // POST /timetable/timetables/:id/copy[?preview=true] — to another term or year, same class (D42).
  @Post("timetables/:id/copy")
  @HttpCode(200)
  @Permissions("timetable.manage")
  async copy(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(copyTimetableSchema)) input: CopyTimetableInput,
    @Query(new ZodValidationPipe(copyPreviewQuerySchema)) query: { preview?: "true" | "false" },
    @Ip() ip: string,
  ): Promise<CopyResultDto> {
    return this.service.copyTimetable(authCtx, id, input, { ipAddress: ip }, { preview: query.preview === "true" });
  }

  // POST /timetable/timetables/:id/publish — snapshot for families, every term it is in force (D45).
  @Post("timetables/:id/publish")
  @HttpCode(200)
  @Permissions("timetable.manage")
  async publish(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Ip() ip: string,
  ): Promise<PublishResultDto> {
    return this.service.publishTimetable(authCtx, id, { ipAddress: ip });
  }

  // POST /timetable/publications/withdraw — remove what families see for one class and term (D45).
  @Post("publications/withdraw")
  @HttpCode(204)
  @Permissions("timetable.manage")
  async withdraw(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(withdrawPublicationSchema)) input: WithdrawPublicationInput,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.withdrawPublication(authCtx, input, { ipAddress: ip });
  }
}
