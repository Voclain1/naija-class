import { Body, Controller, Delete, Get, HttpCode, Ip, Param, Post, Put, Query, UseGuards } from "@nestjs/common";

import {
  createExamPaperSchema,
  drawQuestionsSchema,
  examPaperOutOfQuerySchema,
  exportExamPaperQuerySchema,
  listExamPapersQuerySchema,
  saveExamPaperSchema,
  type CreateExamPaperInput,
  type DrawQuestionsInput,
  type ExamPaperDto,
  type ExamPaperExportDto,
  type ExamPaperOutOfDto,
  type ExamPaperOutOfQuery,
  type ExamPaperSummaryDto,
  type ExportExamPaperQuery,
  type ListExamPapersQuery,
  type QuestionDto,
  type SaveExamPaperInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ExamPapersService } from "./exam-papers.service.js";

// Phase 8c / CP5c — exam papers (docs/modules/phase-8.md §22.3). Two-layer
// gate: @Permissions authorises the role; the service holds a teacher to the
// subjects they teach at each level (D62).

@Controller("exam-papers")
@UseGuards(AuthGuard, PermissionsGuard)
export class ExamPapersController {
  constructor(private readonly service: ExamPapersService) {}

  @Get()
  @Permissions("exam-paper.read")
  list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listExamPapersQuerySchema)) query: ListExamPapersQuery,
  ): Promise<ExamPaperSummaryDto[]> {
    return this.service.list(authCtx, query);
  }

  /** FINAL papers that fill gradebook columns: their totals pre-fill "Out of". */
  @Get("out-of")
  @Permissions("exam-paper.read")
  outOf(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(examPaperOutOfQuerySchema)) query: ExamPaperOutOfQuery,
  ): Promise<ExamPaperOutOfDto> {
    return this.service.outOf(authCtx, query);
  }

  /** Approved questions at random from the bank, to add to a section. */
  @Post("draw")
  @HttpCode(200)
  @Permissions("exam-paper.write")
  draw(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(drawQuestionsSchema)) dto: DrawQuestionsInput,
  ): Promise<QuestionDto[]> {
    return this.service.draw(authCtx, dto);
  }

  @Get(":id")
  @Permissions("exam-paper.read")
  get(@CurrentUser() authCtx: AuthContext, @Param("id") id: string): Promise<ExamPaperDto> {
    return this.service.get(authCtx, id);
  }

  /** A FINAL paper, one version, ready to print or export. Audited. */
  @Get(":id/export")
  @Permissions("exam-paper.read")
  exportData(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(exportExamPaperQuerySchema)) query: ExportExamPaperQuery,
    @Ip() ip: string,
  ): Promise<ExamPaperExportDto> {
    return this.service.exportData(authCtx, id, query, { ipAddress: ip });
  }

  @Post()
  @HttpCode(201)
  @Permissions("exam-paper.write")
  create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createExamPaperSchema)) dto: CreateExamPaperInput,
    @Ip() ip: string,
  ): Promise<ExamPaperDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  /** Replace a draft's header and section structure. */
  @Put(":id")
  @Permissions("exam-paper.write")
  save(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(saveExamPaperSchema)) dto: SaveExamPaperInput,
    @Ip() ip: string,
  ): Promise<ExamPaperDto> {
    return this.service.save(authCtx, id, dto, { ipAddress: ip });
  }

  @Post(":id/finalise")
  @HttpCode(200)
  @Permissions("exam-paper.finalise")
  finalise(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<ExamPaperDto> {
    return this.service.finalise(authCtx, id, { ipAddress: ip });
  }

  /** A new draft copy — the only way to change a FINAL paper. */
  @Post(":id/duplicate")
  @HttpCode(201)
  @Permissions("exam-paper.write")
  duplicate(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<ExamPaperDto> {
    return this.service.duplicate(authCtx, id, { ipAddress: ip });
  }

  /** Deletes a draft. A FINAL paper is never deleted. */
  @Delete(":id")
  @HttpCode(204)
  @Permissions("exam-paper.write")
  remove(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<void> {
    return this.service.remove(authCtx, id, { ipAddress: ip });
  }
}
