import { Controller, Get, HttpCode, Ip, Param, Post, UseGuards } from "@nestjs/common";
import type {
  DeactivateStudentPortalResponse,
  IssueStudentInvitationResponse,
  PortalStudentDto,
  PortalStudentListResponse,
  StudentPortalStatusDto,
} from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard";
import { PortalStudentsService } from "./portal-students.service";
import { StudentAccessService } from "./student-access.service";

// Phase 4 / Slice 3 — the first real parent-facing data endpoints, guarded
// by GuardianAuthGuard (not GuardiansController's staff AuthGuard). Same
// two-caller note as PortalAuthController: apps/portal via its server-side
// proxy, and (since Phase 6 / Slice 2) apps/mobile directly over Bearer.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalStudentsController {
  constructor(
    private readonly service: PortalStudentsService,
    private readonly access: StudentAccessService,
  ) {}

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

  // ---- Phase 6 / Slice 3 — a guardian's controls over their child's
  // portal access. All three go through StudentAccessService.assertLinked,
  // which RAISES 404 for an unknown student and 403 for a student this
  // guardian is not linked to (D27) — never a silent no-op, and never
  // inferred from a rowCount that cannot tell those two apart.

  @Get("students/:id/portal-status")
  async portalStatus(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
  ): Promise<StudentPortalStatusDto> {
    return this.access.getStatus(guardianCtx, id);
  }

  @Post("students/:id/portal-invitation")
  @HttpCode(200)
  async issueInvitation(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<IssueStudentInvitationResponse> {
    return this.access.issueInvitation(guardianCtx, id, { ipAddress: ip });
  }

  @Post("students/:id/deactivate")
  @HttpCode(200)
  async deactivate(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<DeactivateStudentPortalResponse> {
    return this.access.deactivate(guardianCtx, id, { ipAddress: ip });
  }
}
