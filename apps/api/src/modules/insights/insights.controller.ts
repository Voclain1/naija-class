import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { askInsightSchema, type AskInsightInput, type AskInsightResultDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { InsightsService } from "./insights.service.js";

// Owner/admin only. Deliberately NOT granted to teacher: these reports rank
// classes and subjects against each other across the whole school, which is
// management information about colleagues' work, not teaching workflow. A
// teacher's own arm's performance is already visible to them through the
// gradebook and report-card surfaces.
//
// POST rather than GET despite being a read: the question is free text of up
// to 500 characters, and putting an admin's typed question in a URL puts it in
// access logs and browser history for no benefit.
@Controller("insights")
@UseGuards(AuthGuard, PermissionsGuard)
export class InsightsController {
  constructor(private readonly service: InsightsService) {}

  @Post("ask")
  @Permissions("insight.read")
  async ask(
    @Body(new ZodValidationPipe(askInsightSchema)) body: AskInsightInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<AskInsightResultDto> {
    return this.service.ask(authCtx, body);
  }
}
