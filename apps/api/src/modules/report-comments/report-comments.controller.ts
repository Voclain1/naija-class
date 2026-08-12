import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";

import {
  acceptSubjectCommentSchema,
  generateSubjectCommentsSchema,
  listSubjectCommentsSchema,
  type AcceptSubjectCommentInput,
  type GenerateSubjectCommentsInput,
  type GenerateSubjectCommentsResultDto,
  type ListSubjectCommentsInput,
  type SubjectCommentRowDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ReportCommentsService } from "./report-comments.service";

// Teacher-facing. `teacher` holds both report-card-comment.* permissions
// (PHASE_5_TEACHER_PERMISSIONS); admin/owner hold them via the standard rollup.
//
// The two permissions are deliberately not interchangeable: `.generate` spends
// the school's AI budget, `.write` puts text into a student's permanent termly
// record. Read uses `.generate` rather than a third permission — the list is
// the review surface for a batch you were allowed to start, and inventing
// `report-card-comment.read` for it would grow the permission set without
// expressing a decision anyone wants to make separately.
@Controller("report-card-comments")
@UseGuards(AuthGuard, PermissionsGuard)
export class ReportCommentsController {
  constructor(private readonly service: ReportCommentsService) {}

  @Get()
  @Permissions("report-card-comment.generate")
  async list(
    @Query(new ZodValidationPipe(listSubjectCommentsSchema)) query: ListSubjectCommentsInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<SubjectCommentRowDto[]> {
    return this.service.list(authCtx, query);
  }

  // Enqueues one generation per eligible student and returns immediately — a
  // 40-student arm is minutes of work, so the response is a receipt, not a
  // result. The client polls GET / for the suggestions as they land.
  @Post("generate")
  @Permissions("report-card-comment.generate")
  async generate(
    @Body(new ZodValidationPipe(generateSubjectCommentsSchema)) dto: GenerateSubjectCommentsInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<GenerateSubjectCommentsResultDto> {
    return this.service.enqueueBatch(authCtx, dto);
  }

  // The teacher-approval gate CLAUDE.md's AI hard rule requires. This is the
  // only endpoint in the codebase that writes Assessment.subjectComment.
  @Post("accept")
  @Permissions("report-card-comment.write")
  async accept(
    @Body(new ZodValidationPipe(acceptSubjectCommentSchema)) dto: AcceptSubjectCommentInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<SubjectCommentRowDto> {
    return this.service.accept(authCtx, dto);
  }
}
