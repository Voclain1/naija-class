import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
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
}
