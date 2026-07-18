import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { PortalStudentDto, PortalStudentListResponse } from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard";
import { PortalStudentsService } from "./portal-students.service";

// Phase 4 / Slice 3 — the first real parent-facing data endpoints, guarded
// by GuardianAuthGuard (not GuardiansController's staff AuthGuard). Same
// "called only by apps/portal's own server-side proxy route, never
// directly by a browser" note as PortalAuthController.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalStudentsController {
  constructor(private readonly service: PortalStudentsService) {}

  @Get("students")
  async list(@CurrentGuardian() guardianCtx: GuardianAuthContext): Promise<PortalStudentListResponse> {
    return this.service.list(guardianCtx);
  }

  @Get("students/:id")
  async findById(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
  ): Promise<PortalStudentDto> {
    return this.service.findById(guardianCtx, id);
  }
}
