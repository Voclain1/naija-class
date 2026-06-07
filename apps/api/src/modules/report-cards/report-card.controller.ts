import { Body, Controller, Get, HttpCode, Ip, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import {
  buildReportCardsSchema,
  principalNoteUpdateSchema,
  renderArmSchema,
  reportCardArmActionSchema,
  reportCardArmReopenSchema,
  reportCardBoardQuerySchema,
  reportCardCommentUpdateSchema,
  type BuildReportCardsInput,
  type BuildReportCardsResultDto,
  type PrincipalNoteResultDto,
  type PrincipalNoteUpdateInput,
  type RenderArmInput,
  type RenderArmResultDto,
  type ReportCardArmActionInput,
  type ReportCardArmReopenInput,
  type ReportCardBoardQuery,
  type ReportCardBoardResponse,
  type ReportCardCommentUpdateInput,
  type ReportCardDetailDto,
  type ReportCardDto,
  type ReportCardPdfUrlDto,
  type ReportCardTransitionResultDto,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ReportCardService } from "./report-card.service";
import { ReportCardWorkflowService } from "./workflow/report-card-workflow.service";

// NOTE: slice-era guarding — AuthGuard only; the service gates (build/render =
// owner/admin, reads = owner/admin OR form teacher of arm). @Permissions +
// PermissionsGuard land in the slice-9 rollup. Slice 5 ships build + reads; the
// render trigger + PDF endpoints are cp2; release is slice 6.
function reqContext(ip: string, req: Request) {
  return { ipAddress: ip, userAgent: req.header("user-agent") ?? null };
}

@Controller("report-cards")
@UseGuards(AuthGuard)
export class ReportCardsController {
  constructor(
    private readonly service: ReportCardService,
    private readonly workflow: ReportCardWorkflowService,
  ) {}

  @Post("arm/build")
  @HttpCode(200)
  async build(
    @Body(new ZodValidationPipe(buildReportCardsSchema)) dto: BuildReportCardsInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<BuildReportCardsResultDto> {
    return this.service.build(authCtx, dto, reqContext(ip, req));
  }

  // Enqueue a per-card PDF render for every card in (term, arm). Owner/admin
  // only (gated in the service). Returns the count enqueued; the cards' pdfStatus
  // moves PENDING → GENERATING → GENERATED asynchronously.
  @Post("arm/render")
  @HttpCode(202)
  async render(
    @Body(new ZodValidationPipe(renderArmSchema)) dto: RenderArmInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<RenderArmResultDto> {
    return this.service.enqueueArmRender(authCtx, dto, reqContext(ip, req));
  }

  // Arm-batch workflow transitions (slice 6). Each moves every card in (term,
  // arm) together; out-of-order → 409. form-review = owner/admin OR form
  // teacher; approve = owner/admin (both gated in the workflow service).
  @Post("arm/form-review")
  @HttpCode(200)
  async formReview(
    @Body(new ZodValidationPipe(reportCardArmActionSchema)) dto: ReportCardArmActionInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ReportCardTransitionResultDto> {
    return this.workflow.formReview(authCtx, dto, reqContext(ip, req));
  }

  @Post("arm/approve")
  @HttpCode(200)
  async approve(
    @Body(new ZodValidationPipe(reportCardArmActionSchema)) dto: ReportCardArmActionInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ReportCardTransitionResultDto> {
    return this.workflow.approve(authCtx, dto, reqContext(ip, req));
  }

  // Release (owner/admin): PRINCIPAL_APPROVED → RELEASED + enqueue render jobs,
  // atomically. Reopen (owner only): audited rollback to DRAFT.
  @Post("arm/release")
  @HttpCode(200)
  async release(
    @Body(new ZodValidationPipe(reportCardArmActionSchema)) dto: ReportCardArmActionInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ReportCardTransitionResultDto> {
    return this.workflow.release(authCtx, dto, reqContext(ip, req));
  }

  @Post("arm/reopen")
  @HttpCode(200)
  async reopen(
    @Body(new ZodValidationPipe(reportCardArmReopenSchema)) dto: ReportCardArmReopenInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ReportCardTransitionResultDto> {
    return this.workflow.reopen(authCtx, dto, reqContext(ip, req));
  }

  // The arm-term principal note, fanned out to every card in (term, arm).
  // Owner/admin; FORM_REVIEWED only. PUT (not PATCH) — it's an arm-level upsert
  // of one value, the split from the per-card formTeacherComment makes the
  // fan-out visible at the URL.
  @Put("arm/principal-note")
  @HttpCode(200)
  async principalNote(
    @Body(new ZodValidationPipe(principalNoteUpdateSchema)) dto: PrincipalNoteUpdateInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PrincipalNoteResultDto> {
    return this.workflow.editPrincipalNote(authCtx, dto, reqContext(ip, req));
  }

  @Get()
  async board(
    @Query(new ZodValidationPipe(reportCardBoardQuerySchema)) query: ReportCardBoardQuery,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<ReportCardBoardResponse> {
    return this.service.getBoard(authCtx, query);
  }

  // A short-lived signed URL to the rendered PDF. 404 until pdfStatus is
  // GENERATED. Declared BEFORE @Get(":id") so "/:id/pdf" is not swallowed by
  // the bare ":id" route.
  @Get(":id/pdf")
  async pdfUrl(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<ReportCardPdfUrlDto> {
    return this.service.getPdfUrl(authCtx, id);
  }

  @Get(":id")
  async findById(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<ReportCardDetailDto> {
    return this.service.getById(authCtx, id);
  }

  // Per-card form-teacher comment. owner/admin OR the arm's form teacher;
  // editable in DRAFT / SUBJECT_REVIEWED only (gated in the workflow service).
  @Patch(":id")
  async editComment(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reportCardCommentUpdateSchema)) dto: ReportCardCommentUpdateInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ReportCardDto> {
    return this.workflow.editFormTeacherComment(authCtx, id, dto, reqContext(ip, req));
  }
}
