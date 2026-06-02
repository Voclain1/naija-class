import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  assessmentFeedQuerySchema,
  createAssessmentScoreSchema,
  updateAssessmentScoreSchema,
  type AssessmentFeedQuery,
  type AssessmentFeedResponse,
  type AssessmentWithScoresDto,
  type CreateAssessmentScoreInput,
  type UpdateAssessmentScoreInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AssessmentService } from "./assessment.service";

// NOTE: slice-2-era guarding — AuthGuard only, with the service gating via
// assertUserActiveAndHasOneOf(['owner','admin','teacher']) + the teacher-scope
// pre-check. @Permissions + PermissionsGuard are wired in the slice-9 RBAC
// rollup (same deferral as slices 1–2 of Phase 2).

function reqContext(ip: string, req: Request) {
  return { ipAddress: ip, userAgent: req.header("user-agent") ?? null };
}

@Controller("assessment-scores")
@UseGuards(AuthGuard)
export class AssessmentScoresController {
  constructor(private readonly service: AssessmentService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createAssessmentScoreSchema)) dto: CreateAssessmentScoreInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AssessmentWithScoresDto> {
    return this.service.createScore(authCtx, dto, reqContext(ip, req));
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAssessmentScoreSchema)) dto: UpdateAssessmentScoreInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AssessmentWithScoresDto> {
    return this.service.updateScore(authCtx, id, dto, reqContext(ip, req));
  }
}

@Controller("assessments")
@UseGuards(AuthGuard)
export class AssessmentsController {
  constructor(private readonly service: AssessmentService) {}

  // Gradebook column feed. Declared before ":id" so "/assessments?..." with no
  // path segment routes here (Nest matches the empty path on GET / regardless,
  // but keeping it first documents intent).
  @Get()
  async feed(
    @Query(new ZodValidationPipe(assessmentFeedQuerySchema)) query: AssessmentFeedQuery,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AssessmentFeedResponse> {
    return this.service.getFeed(authCtx, query);
  }

  @Get(":id")
  async findById(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AssessmentWithScoresDto> {
    return this.service.getById(authCtx, id);
  }
}
