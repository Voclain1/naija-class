import { Controller, Get, Ip, Query, UseGuards } from "@nestjs/common";
import {
  completenessQuerySchema,
  type CompletenessQuery,
  type CompletenessReportDto,
  type TeacherActivityReportDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CompletenessService } from "./completeness.service.js";

// Phase 8 / CP2 — Recording Completeness (docs/modules/phase-8.md §16 D38).
// Owner/admin only, at both gates. Two endpoints, two permissions, on purpose:
// the teacher view is separately grantable, separately pinned, and audited per
// read (§3.4 D23).
@Controller("reports")
@UseGuards(AuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly service: CompletenessService) {}

  @Get("completeness")
  @Permissions("reports.completeness.read")
  async completeness(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(completenessQuerySchema)) query: CompletenessQuery,
  ): Promise<CompletenessReportDto> {
    return this.service.getCompleteness(authCtx, query.termId);
  }

  @Get("teacher-activity")
  @Permissions("reports.teacher-activity.read")
  async teacherActivity(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(completenessQuerySchema)) query: CompletenessQuery,
    @Ip() ip: string,
  ): Promise<TeacherActivityReportDto> {
    return this.service.getTeacherActivity(authCtx, query.termId, { ipAddress: ip });
  }
}
