import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { HealthDocumentUrlDto, PortalHealthProfileDto } from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { HealthService } from "./health.service.js";

// Phase 9 / CP3.1 — a guardian reads their own child's health profile
// (docs/modules/phase-9.md §10 CP3-D3). Read-only, audited, behind
// withGuardian. The student's own portal has no equivalent.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalHealthController {
  constructor(private readonly service: HealthService) {}

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
}
