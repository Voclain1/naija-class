import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import {
  completenessExportQuerySchema,
  completenessPdfRequestSchema,
  completenessQuerySchema,
  teacherActivityExportQuerySchema,
  teacherActivityPdfRequestSchema,
  type CompletenessExportQuery,
  type CompletenessPdfRequest,
  type CompletenessQuery,
  type CompletenessReportDto,
  type ReportExportStatusDto,
  type ReportPdfAcceptedDto,
  type TeacherActivityExportQuery,
  type TeacherActivityPdfRequest,
  type TeacherActivityReportDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CompletenessService } from "./completeness.service.js";
import { ReportExportsService, type ExportFile } from "./report-exports.service.js";

function sendFile(res: Response, file: ExportFile): void {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(file.body);
}

// Phase 8 / CP2 — Recording Completeness (docs/modules/phase-8.md §16 D38).
// Owner/admin only, at both gates. Two endpoints, two permissions, on purpose:
// the teacher view is separately grantable, separately pinned, and audited per
// read (§3.4 D23).
//
// Phase 9 / CP1.1 exports (docs/modules/phase-9.md §8): each export route
// declares BOTH `reports.export` and the report's own read permission, and
// the guard requires all of them, so a copy never reaches a report the person
// cannot open. Excel downloads at once; a PDF is queued and polled.
@Controller("reports")
@UseGuards(AuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(
    private readonly service: CompletenessService,
    private readonly exports: ReportExportsService,
  ) {}

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

  @Get("completeness/export")
  @Permissions("reports.completeness.read", "reports.export")
  async completenessExport(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(completenessExportQuerySchema)) query: CompletenessExportQuery,
    @Ip() ip: string,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.exports.completenessFile(authCtx, query.section, query.termId, { ipAddress: ip }));
  }

  @Post("completeness/pdf")
  @HttpCode(202)
  @Permissions("reports.completeness.read", "reports.export")
  async completenessPdf(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(completenessPdfRequestSchema)) body: CompletenessPdfRequest,
    @Ip() ip: string,
  ): Promise<ReportPdfAcceptedDto> {
    return this.exports.requestCompletenessPdf(authCtx, body.section, body.termId, { ipAddress: ip });
  }

  @Get("teacher-activity/export")
  @Permissions("reports.teacher-activity.read", "reports.export")
  async teacherActivityExport(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(teacherActivityExportQuerySchema)) query: TeacherActivityExportQuery,
    @Ip() ip: string,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.exports.teacherActivityFile(authCtx, query.termId, { ipAddress: ip }));
  }

  @Post("teacher-activity/pdf")
  @HttpCode(202)
  @Permissions("reports.teacher-activity.read", "reports.export")
  async teacherActivityPdf(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(teacherActivityPdfRequestSchema)) body: TeacherActivityPdfRequest,
    @Ip() ip: string,
  ): Promise<ReportPdfAcceptedDto> {
    return this.exports.requestTeacherActivityPdf(authCtx, body.termId, { ipAddress: ip });
  }

  @Get("exports/:exportId")
  @Permissions("reports.export")
  async exportStatus(
    @CurrentUser() authCtx: AuthContext,
    @Param("exportId", new ParseUUIDPipe()) exportId: string,
  ): Promise<ReportExportStatusDto> {
    return this.exports.getPdfStatus(authCtx, exportId);
  }
}
