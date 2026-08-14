import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { getAiUsageSchema, type AiUsageDto, type GetAiUsageInput } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AiUsageService } from "./ai-usage.service.js";

// Owner/admin only. `ai-usage.read` is deliberately absent from the teacher
// grant (PHASE_5_TEACHER_PERMISSIONS): school-level spend is operator
// information, not teaching workflow.
@Controller("ai-usage")
@UseGuards(AuthGuard, PermissionsGuard)
export class AiUsageController {
  constructor(private readonly service: AiUsageService) {}

  @Get()
  @Permissions("ai-usage.read")
  async get(
    @Query(new ZodValidationPipe(getAiUsageSchema)) query: GetAiUsageInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AiUsageDto> {
    return this.service.getUsage(authCtx, query);
  }
}
