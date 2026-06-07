import { Body, Controller, Get, HttpCode, Ip, Post, Query, Req, UseGuards } from "@nestjs/common";

import {
  attendanceMarkSchema,
  attendanceRegisterQuerySchema,
  attendanceSummaryQuerySchema,
  type AttendanceMarkInput,
  type AttendanceMarkResultDto,
  type AttendanceRegisterQuery,
  type AttendanceRegisterResponse,
  type AttendanceSummaryQuery,
  type AttendanceSummaryResponse,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AttendanceService } from "./attendance.service";

// NOTE: slice-2-era guarding — AuthGuard only, with the service gating via
// assertUserActiveAndHasOneOf(['owner','admin','teacher']) + the form-teacher
// scope check. @Permissions + PermissionsGuard arrive in the slice-9 RBAC
// rollup (same deferral as the other Phase-2 modules).

function reqContext(ip: string, req: Request) {
  return { ipAddress: ip, userAgent: req.header("user-agent") ?? null };
}

@Controller("attendance")
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  // GET /attendance/register?classArmId=&date= — the day's register for one arm.
  @Get("register")
  async register(
    @Query(new ZodValidationPipe(attendanceRegisterQuerySchema)) query: AttendanceRegisterQuery,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AttendanceRegisterResponse> {
    return this.service.getRegister(authCtx, query);
  }

  // POST /attendance/mark — upsert the day's register (atomic). Returns { count }.
  @Post("mark")
  @HttpCode(200)
  async mark(
    @Body(new ZodValidationPipe(attendanceMarkSchema)) dto: AttendanceMarkInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AttendanceMarkResultDto> {
    return this.service.markBulk(authCtx, dto, reqContext(ip, req));
  }

  // GET /attendance/summary?classArmId=&termId= — per-student term stats.
  @Get("summary")
  async summary(
    @Query(new ZodValidationPipe(attendanceSummaryQuerySchema)) query: AttendanceSummaryQuery,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AttendanceSummaryResponse> {
    return this.service.getSummary(authCtx, query);
  }
}
