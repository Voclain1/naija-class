import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  buildReportCardsSchema,
  renderArmSchema,
  reportCardArmActionSchema,
  reportCardBoardQuerySchema,
  type BuildReportCardsInput,
  type BuildReportCardsResultDto,
  type RenderArmInput,
  type RenderArmResultDto,
  type ReportCardArmActionInput,
  type ReportCardBoardQuery,
  type ReportCardBoardResponse,
  type ReportCardDetailDto,
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
}
