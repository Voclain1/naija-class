import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createLessonPlanSchema,
  listLessonPlansSchema,
  updateLessonPlanSchema,
  type CreateLessonPlanInput,
  type LessonPlanDto,
  type LessonPlanSummaryDto,
  type ListLessonPlansInput,
  type UpdateLessonPlanInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { LessonPlansService } from "./lesson-plans.service";

// Teacher-facing. `teacher` holds the full lesson-plan.* set
// (PHASE_5_TEACHER_PERMISSIONS); admin/owner hold it too via the standard
// rollup. Bursar is excluded — finance-only role.
@Controller("lesson-plans")
@UseGuards(AuthGuard, PermissionsGuard)
export class LessonPlansController {
  constructor(private readonly service: LessonPlansService) {}

  @Get()
  @Permissions("lesson-plan.read")
  async list(
    @Query(new ZodValidationPipe(listLessonPlansSchema)) query: ListLessonPlansInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<LessonPlanSummaryDto[]> {
    return this.service.list(authCtx.schoolId, authCtx.userId, query);
  }

  @Get(":id")
  @Permissions("lesson-plan.read")
  async get(@Param("id") id: string, @CurrentUser() authCtx: AuthContext): Promise<LessonPlanDto> {
    return this.service.get(authCtx.schoolId, id);
  }

  // Creates the row AND runs the generation — a single call, because a row
  // with no content is not a thing a teacher ever wants on purpose.
  @Post()
  @Permissions("lesson-plan.create")
  async create(
    @Body(new ZodValidationPipe(createLessonPlanSchema)) dto: CreateLessonPlanInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<LessonPlanDto> {
    return this.service.createAndGenerate(authCtx.schoolId, authCtx.userId, dto);
  }

  // Quiz mode is a second generation against an existing plan, so it is a
  // POST on the sub-resource rather than a flag on create.
  @Post(":id/quiz")
  @Permissions("lesson-plan.update")
  async generateQuiz(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<LessonPlanDto> {
    return this.service.generateQuiz(authCtx.schoolId, authCtx.userId, id);
  }

  @Patch(":id")
  @Permissions("lesson-plan.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateLessonPlanSchema)) dto: UpdateLessonPlanInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<LessonPlanDto> {
    return this.service.update(authCtx.schoolId, id, dto);
  }

  @Delete(":id")
  @Permissions("lesson-plan.delete")
  async remove(@Param("id") id: string, @CurrentUser() authCtx: AuthContext): Promise<void> {
    return this.service.remove(authCtx.schoolId, id);
  }
}
