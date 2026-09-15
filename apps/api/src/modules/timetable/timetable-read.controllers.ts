import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import {
  teacherTimetableQuerySchema,
  type FamilyTimetableDto,
  type TeacherTimetableDto,
  type TeacherTimetableQuery,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { TimetableFamilyReader } from "./timetable-family-reader.js";
import { TimetableTeacherReader } from "./timetable-teacher-reader.js";

// Phase 8 / CP4 — timetable read surfaces (docs/modules/phase-8.md §18 D37–D39, D45).

// GET /teacher-scope/me/timetable — the caller's own lessons + form-class grids.
// timetable.own.read is held by the teacher role only; the reader re-asserts the
// teacher role (two gates), like every /teacher-scope route.
@Controller("teacher-scope")
@UseGuards(AuthGuard, PermissionsGuard)
export class TeacherTimetableController {
  constructor(private readonly reader: TimetableTeacherReader) {}

  @Get("me/timetable")
  @Permissions("timetable.own.read")
  async myTimetable(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(teacherTimetableQuerySchema)) query: TeacherTimetableQuery,
  ): Promise<TeacherTimetableDto> {
    return this.reader.getMyTimetable(authCtx, query.termId);
  }
}

// GET /portal/students/:id/timetable — a linked child's PUBLISHED class timetable.
// The school is the guardian session's; the link is proven in the reader.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalTimetableController {
  constructor(private readonly reader: TimetableFamilyReader) {}

  @Get("students/:id/timetable")
  async childTimetable(
    @CurrentGuardian() ctx: GuardianAuthContext,
    @Param("id", new ParseUUIDPipe()) studentId: string,
  ): Promise<FamilyTimetableDto> {
    return this.reader.forGuardian(ctx.schoolId, ctx.guardianId, studentId);
  }
}

// GET /student-portal/me/timetable — the student's own PUBLISHED class timetable.
@Controller("student-portal")
export class StudentTimetableController {
  constructor(private readonly reader: TimetableFamilyReader) {}

  @Get("me/timetable")
  @UseGuards(StudentAuthGuard)
  async myTimetable(@CurrentStudent() ctx: StudentAuthContext): Promise<FamilyTimetableDto> {
    return this.reader.forStudent(ctx.schoolId, ctx.studentId);
  }
}
