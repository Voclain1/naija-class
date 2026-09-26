import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query, UseGuards } from "@nestjs/common";

import {
  createHomeworkSchema,
  homeworkListQuerySchema,
  type CreateHomeworkInput,
  type HomeworkDto,
  type HomeworkFeedResponse,
  type HomeworkListQuery,
  type HomeworkListResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { HomeworkService } from "./homework.service.js";

// Homework (docs/modules/the-school-day.md Part B), one controller per
// principal — the same shape announcements and devices use, for the same
// reason: three different guards, one service.
//
// Two-layer gate on the staff side: @Permissions authorises the grant, and the
// service re-checks the role AND the teacher's own scope, so a custom role
// granted homework.create still cannot set work for a class nobody assigned
// them to.

@Controller("homework")
@UseGuards(AuthGuard, PermissionsGuard)
export class HomeworkController {
  constructor(private readonly service: HomeworkService) {}

  @Post()
  @HttpCode(201)
  @Permissions("homework.create")
  async create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createHomeworkSchema)) dto: CreateHomeworkInput,
    @Ip() ip: string,
  ): Promise<HomeworkDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Get()
  @Permissions("homework.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(homeworkListQuerySchema)) query: HomeworkListQuery,
  ): Promise<HomeworkListResponse> {
    return this.service.list(authCtx, query);
  }

  /**
   * Withdraw, not delete (B10). A child who wrote it down deserves a record
   * that it existed and was cancelled.
   */
  @Post(":id/withdraw")
  @HttpCode(200)
  @Permissions("homework.create")
  async withdraw(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<HomeworkDto> {
    return this.service.withdraw(authCtx, id, { ipAddress: ip });
  }
}

@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalHomeworkController {
  constructor(private readonly service: HomeworkService) {}

  /** Under students/:id, like invoices: a parent reads one child at a time. */
  @Get("students/:id/homework")
  async forChild(
    @CurrentGuardian() ctx: GuardianAuthContext,
    @Param("id") id: string,
  ): Promise<HomeworkFeedResponse> {
    return this.service.forGuardianChild(ctx, id);
  }
}

@Controller("student-portal")
@UseGuards(StudentAuthGuard)
export class StudentHomeworkController {
  constructor(private readonly service: HomeworkService) {}

  /**
   * No student id in the path — the session is the identity, which is the rule
   * the whole student surface follows (phase-6 §8).
   */
  @Get("me/homework")
  async mine(@CurrentStudent() ctx: StudentAuthContext): Promise<HomeworkFeedResponse> {
    return this.service.forStudentSelf(ctx.schoolId, ctx.studentId);
  }
}
