import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { HealthDocumentUrlDto, PortalHealthProfileDto, PortalSickbayVisitListResponse } from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { HealthService } from "./health.service.js";
import { SickbayService } from "./sickbay.service.js";

// Phase 9 / CP3.1 — a guardian reads their own child's health profile
// (docs/modules/phase-9.md §10 CP3-D3). Read-only, audited, behind
// withGuardian. The student's own portal has no equivalent.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalHealthController {
  constructor(
    private readonly service: HealthService,
    private readonly sickbay: SickbayService,
  ) {}

  @Get("students/:id/health")
  async profile(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
  ): Promise<PortalHealthProfileDto> {
    return this.service.profileForGuardian(guardianCtx, id);
  }

  // Phase 9 / CP3.2 — a five-minute link to a vaccination's document, for a
  // guardian linked to the child.
  @Get("students/:id/vaccinations/:vaccinationId/document")
  async document(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
    @Param("vaccinationId") vaccinationId: string,
  ): Promise<HealthDocumentUrlDto> {
    return this.service.documentUrlForGuardian(guardianCtx, id, vaccinationId);
  }

  // Phase 9 / CP3.3 — the child's sickbay visits: the time and whether they
  // were sent home, and the details only when the school shared them.
  @Get("students/:id/sickbay-visits")
  async sickbayVisits(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
  ): Promise<PortalSickbayVisitListResponse> {
    return this.sickbay.visitsForGuardian(guardianCtx, id);
  }
}
