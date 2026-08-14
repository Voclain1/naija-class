import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { PortalParentSummaryListResponse } from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { ParentSummariesService } from "./parent-summaries.service.js";

// The guardian-facing read. Separate controller from the staff one because
// the guard is different (GuardianAuthGuard, not AuthGuard) — the same split
// PortalStudentsController established in Phase 4 / Slice 3.
//
// Lives in this module rather than in portal-students because the service and
// the generation logic are one unit: the sweep, the write, and the read all
// share the eligibility rules. Splitting the read into the portal module
// would put the two halves of one feature in two places for no gain.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalParentSummariesController {
  constructor(private readonly service: ParentSummariesService) {}

  @Get("students/:id/summaries")
  async list(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
  ): Promise<PortalParentSummaryListResponse> {
    return this.service.listForGuardian(guardianCtx, id);
  }
}
