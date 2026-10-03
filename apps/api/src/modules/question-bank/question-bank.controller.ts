import { Body, Controller, Delete, Get, HttpCode, Ip, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import {
  createQuestionSchema,
  generateQuestionsSchema,
  listQuestionsQuerySchema,
  updateQuestionSchema,
  type CreateQuestionInput,
  type GenerateQuestionsInput,
  type GenerateQuestionsResponse,
  type ListQuestionsQuery,
  type QuestionDto,
  type QuestionScopeDto,
  type UpdateQuestionInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { QuestionBankService } from "./question-bank.service.js";

// Phase 8c / CP5b — the question bank (docs/modules/phase-8.md §22.2).
//
// Two-layer gate: @Permissions authorises the role; QuestionBankService holds
// a teacher to the subjects they teach at each class level (D62).

@Controller("questions")
@UseGuards(AuthGuard, PermissionsGuard)
export class QuestionBankController {
  constructor(private readonly service: QuestionBankService) {}

  /** The (class level, subject) pairs the caller may work on. */
  @Get("scope")
  @Permissions("question.read")
  scope(@CurrentUser() authCtx: AuthContext): Promise<QuestionScopeDto> {
    return this.service.getScope(authCtx);
  }

  @Get()
  @Permissions("question.read")
  list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listQuestionsQuerySchema)) query: ListQuestionsQuery,
  ): Promise<QuestionDto[]> {
    return this.service.list(authCtx, query);
  }

  /** AI drafting. Spends the school's AI budget; every result is a DRAFT. */
  @Post("generate")
  @HttpCode(201)
  @Permissions("question.generate")
  generate(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(generateQuestionsSchema)) dto: GenerateQuestionsInput,
    @Ip() ip: string,
  ): Promise<GenerateQuestionsResponse> {
    return this.service.generate(authCtx, dto, { ipAddress: ip });
  }

  @Get(":id")
  @Permissions("question.read")
  get(@CurrentUser() authCtx: AuthContext, @Param("id") id: string): Promise<QuestionDto> {
    return this.service.get(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("question.write")
  create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createQuestionSchema)) dto: CreateQuestionInput,
    @Ip() ip: string,
  ): Promise<QuestionDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  /** Edits a draft in place; for an approved question, returns a new draft revision. */
  @Patch(":id")
  @Permissions("question.write")
  update(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateQuestionSchema)) dto: UpdateQuestionInput,
    @Ip() ip: string,
  ): Promise<QuestionDto> {
    return this.service.update(authCtx, id, dto, { ipAddress: ip });
  }

  @Post(":id/approve")
  @HttpCode(200)
  @Permissions("question.approve")
  approve(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<QuestionDto> {
    return this.service.approve(authCtx, id, { ipAddress: ip });
  }

  @Post(":id/retire")
  @HttpCode(200)
  @Permissions("question.approve")
  retire(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<QuestionDto> {
    return this.service.retire(authCtx, id, { ipAddress: ip });
  }

  /** Discards a draft. Approved questions are retired, never deleted. */
  @Delete(":id")
  @HttpCode(204)
  @Permissions("question.write")
  discard(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<void> {
    return this.service.discard(authCtx, id, { ipAddress: ip });
  }
}
