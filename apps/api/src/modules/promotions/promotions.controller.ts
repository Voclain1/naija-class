import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  commitPromotionSchema,
  previewPromotionQuerySchema,
  type CommitPromotionInput,
  type PreviewPromotionQuery,
  type PromotionCommitResultDto,
  type PromotionPreviewDto,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PromotionsService } from "./promotions.service";

// Promotion engine — docs/modules/promotion-engine.md.
//
// Two endpoints and two permissions. Looking at the plan (`promotion.read`) is
// deliberately cheaper to hold than applying it (`promotion.commit`): one
// commit writes an enrollment for every student in the school.
@Controller("promotions")
@UseGuards(AuthGuard, PermissionsGuard)
export class PromotionsController {
  constructor(private readonly service: PromotionsService) {}

  @Get("preview")
  @Permissions("promotion.read")
  async preview(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(previewPromotionQuerySchema))
    query: PreviewPromotionQuery,
  ): Promise<PromotionPreviewDto> {
    return this.service.preview(authCtx, query);
  }

  // 200, not 201: the response is a summary of what happened, not a created
  // resource with an id. Same call is safe to repeat — already-enrolled
  // students come back in `skipped`.
  @Post("commit")
  @HttpCode(200)
  @Permissions("promotion.commit")
  async commit(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(commitPromotionSchema))
    dto: CommitPromotionInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PromotionCommitResultDto> {
    return this.service.commit(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
