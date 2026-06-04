import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  buildReportCardsSchema,
  reportCardBoardQuerySchema,
  type BuildReportCardsInput,
  type BuildReportCardsResultDto,
  type ReportCardBoardQuery,
  type ReportCardBoardResponse,
  type ReportCardDetailDto,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ReportCardService } from "./report-card.service";

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
  constructor(private readonly service: ReportCardService) {}

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

  @Get()
  async board(
    @Query(new ZodValidationPipe(reportCardBoardQuerySchema)) query: ReportCardBoardQuery,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<ReportCardBoardResponse> {
    return this.service.getBoard(authCtx, query);
  }

  @Get(":id")
  async findById(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<ReportCardDetailDto> {
    return this.service.getById(authCtx, id);
  }
}
