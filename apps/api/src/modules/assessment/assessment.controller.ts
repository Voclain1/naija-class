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
  aggregateInputSchema,
  aggregateStatusQuerySchema,
  assessmentFeedQuerySchema,
  bulkAssessmentScoreSchema,
  createAssessmentScoreSchema,
  signOffBulkSchema,
  updateAssessmentScoreSchema,
  type AggregateInput,
  type AggregateResultDto,
  type AggregateStatusQuery,
  type AggregateStatusResponse,
  type AssessmentDto,
  type AssessmentFeedQuery,
  type AssessmentFeedResponse,
  type AssessmentWithScoresDto,
  type BulkAssessmentScoreInput,
  type CreateAssessmentScoreInput,
  type SignOffBulkInput,
  type UpdateAssessmentScoreInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AggregationService } from "./aggregation.service";
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

  // Bulk column save — atomic all-or-nothing. Returns the refreshed feed.
  @Post("bulk")
  @HttpCode(200)
  async bulk(
    @Body(new ZodValidationPipe(bulkAssessmentScoreSchema)) dto: BulkAssessmentScoreInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AssessmentFeedResponse> {
    return this.service.bulkUpsertScores(authCtx, dto, reqContext(ip, req));
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
  constructor(
    private readonly service: AssessmentService,
    private readonly aggregation: AggregationService,
  ) {}

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

  // Position aggregation (slice 4). Static paths declared before ":id" routes.
  @Post("aggregate")
  @HttpCode(200)
  async aggregate(
    @Body(new ZodValidationPipe(aggregateInputSchema)) dto: AggregateInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AggregateResultDto> {
    return this.aggregation.aggregate(authCtx, dto, reqContext(ip, req));
  }

  @Get("aggregate/status")
  async aggregateStatus(
    @Query(new ZodValidationPipe(aggregateStatusQuerySchema)) query: AggregateStatusQuery,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AggregateStatusResponse> {
    return this.aggregation.getStatus(authCtx, query.termId, query.classArmId);
  }

  // Bulk column sign-off — declared before ":id/sign-off" for clarity (the
  // patterns don't collide: "sign-off/bulk" vs ":id/sign-off").
  @Post("sign-off/bulk")
  @HttpCode(200)
  async signOffColumn(
    @Body(new ZodValidationPipe(signOffBulkSchema)) dto: SignOffBulkInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AssessmentDto[]> {
    return this.service.signOffColumn(authCtx, dto, reqContext(ip, req));
  }

  @Post(":id/sign-off")
  @HttpCode(200)
  async signOff(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AssessmentDto> {
    return this.service.signOff(authCtx, id, reqContext(ip, req));
  }

  @Get(":id")
  async findById(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AssessmentWithScoresDto> {
    return this.service.getById(authCtx, id);
  }
}
