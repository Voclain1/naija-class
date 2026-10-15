import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { PortalDisciplineNoticeListResponse } from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { DisciplineService } from "./discipline.service.js";

// Phase 9 / CP2.3 — the ONE family-facing behaviour route (CP2-D4, the narrow
// reversal of C14). It returns approved suspensions and exclusions: the
// action, its dates and when it was decided. Its response type has no field
// for a reason, a note, an incident or who proposed it, so there is still no
// route that can return a behaviour note to a family. The student's own
// portal gets nothing.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalDisciplineController {
  constructor(private readonly service: DisciplineService) {}

  @Get("students/:id/discipline-notices")
  async list(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
  ): Promise<PortalDisciplineNoticeListResponse> {
    return this.service.listNoticesForGuardian(guardianCtx, id);
  }
}
