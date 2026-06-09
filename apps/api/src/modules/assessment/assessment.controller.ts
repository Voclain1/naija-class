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
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AggregationService } from "./aggregation.service";
import { AssessmentService } from "./assessment.service";

// Two-layer gate (slice 9 RBAC rollup): @Permissions on every handler is the
// coarse role authorization (PermissionsGuard); the service's
// assertUserActiveAndHasOneOf + getTeacherScope pre-check narrows it to the
// teacher's own (arm, subject). The guard rejects unauthorized users; the
// service scopes authorized ones.

function reqContext(ip: string, req: Request) {
  return { ipAddress: ip, userAgent: req.header("user-agent") ?? null };
}

@Controller("assessment-scores")
@UseGuards(AuthGuard, PermissionsGuard)
export class AssessmentScoresController {
  constructor(private readonly service: AssessmentService) {}

  @Post()
  @HttpCode(201)
  @Permissions("assessment-score.create")
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
  @Permissions("assessment-score.create")
  async bulk(
    @Body(new ZodValidationPipe(bulkAssessmentScoreSchema)) dto: BulkAssessmentScoreInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AssessmentFeedResponse> {
    return this.service.bulkUpsertScores(authCtx, dto, reqContext(ip, req));
  }

  @Patch(":id")
  @Permissions("assessment-score.update")
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
@UseGuards(AuthGuard, PermissionsGuard)
export class AssessmentsController {
  constructor(
    private readonly service: AssessmentService,
    private readonly aggregation: AggregationService,
  ) {}

  // Gradebook column feed. Declared before ":id" so "/assessments?..." with no
  // path segment routes here (Nest matches the empty path on GET / regardless,
  // but keeping it first documents intent).
  @Get()
  @Permissions("assessment.read")
  async feed(
    @Query(new ZodValidationPipe(assessmentFeedQuerySchema)) query: AssessmentFeedQuery,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AssessmentFeedResponse> {
    return this.service.getFeed(authCtx, query);
  }

  // Position aggregation (slice 4). Static paths declared before ":id" routes.
  @Post("aggregate")
  @HttpCode(200)
  @Permissions("assessment.aggregate")
  async aggregate(
    @Body(new ZodValidationPipe(aggregateInputSchema)) dto: AggregateInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AggregateResultDto> {
    return this.aggregation.aggregate(authCtx, dto, reqContext(ip, req));
  }

  @Get("aggregate/status")
  @Permissions("assessment.read")
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
  @Permissions("assessment.sign-off")
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
  @Permissions("assessment.sign-off")
  async signOff(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AssessmentDto> {
    return this.service.signOff(authCtx, id, reqContext(ip, req));
  }

  @Get(":id")
  @Permissions("assessment.read")
  async findById(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AssessmentWithScoresDto> {
    return this.service.getById(authCtx, id);
  }
}
