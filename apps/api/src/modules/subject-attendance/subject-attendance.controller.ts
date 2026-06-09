import { Body, Controller, Get, HttpCode, Ip, Post, Query, Req, UseGuards } from "@nestjs/common";

import {
  subjectAttendanceMarkSchema,
  subjectAttendanceRegisterQuerySchema,
  subjectAttendanceSummaryQuerySchema,
  type SubjectAttendanceMarkInput,
  type SubjectAttendanceMarkResultDto,
  type SubjectAttendanceRegisterQuery,
  type SubjectAttendanceRegisterResponse,
  type SubjectAttendanceSummaryQuery,
  type SubjectAttendanceSummaryResponse,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { SubjectAttendanceService } from "./subject-attendance.service";

// Opt-in: all three endpoints 404 (via the service's assertEnabled) when the
// school hasn't set subjectAttendanceEnabled. Slice-2-era guarding — AuthGuard
// only, with the service gating via assertUserActiveAndHasOneOf + the
// subject-scope check. @Permissions arrives in the slice-9 RBAC rollup.

function reqContext(ip: string, req: Request) {
  return { ipAddress: ip, userAgent: req.header("user-agent") ?? null };
}

@Controller("subject-attendance")
@UseGuards(AuthGuard)
export class SubjectAttendanceController {
  constructor(private readonly service: SubjectAttendanceService) {}

  // GET /subject-attendance/register?classArmId=&subjectId=&date=&period=
  @Get("register")
  async register(
    @Query(new ZodValidationPipe(subjectAttendanceRegisterQuerySchema))
    query: SubjectAttendanceRegisterQuery,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<SubjectAttendanceRegisterResponse> {
    return this.service.getRegister(authCtx, query);
  }

  // POST /subject-attendance/mark — upsert one (subject, date, period). { count }.
  @Post("mark")
  @HttpCode(200)
  async mark(
    @Body(new ZodValidationPipe(subjectAttendanceMarkSchema)) dto: SubjectAttendanceMarkInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SubjectAttendanceMarkResultDto> {
    return this.service.markBulk(authCtx, dto, reqContext(ip, req));
  }

  // GET /subject-attendance/summary?classArmId=&subjectId=&termId=
  @Get("summary")
  async summary(
    @Query(new ZodValidationPipe(subjectAttendanceSummaryQuerySchema))
    query: SubjectAttendanceSummaryQuery,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<SubjectAttendanceSummaryResponse> {
    return this.service.getSummary(authCtx, query);
  }
}
