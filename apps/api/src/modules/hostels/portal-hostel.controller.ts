import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import type { PortalStudentHostelDto } from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { HostelHouseService } from "./hostel-house.service.js";

// Phase 9 / CP6b.2 — a guardian reads their own child's hostel, room and bed
// this term and the house masters' names (docs/modules/phase-9.md §15
// CP6b-D8). Behind withGuardian. null when the child is not a boarder this
// term. No visitor log: parents do not see it (owner, §15.8).
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalHostelController {
  constructor(private readonly service: HostelHouseService) {}

  @Get("students/:id/hostel")
  hostel(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<PortalStudentHostelDto | null> {
    return this.service.hostelForGuardian(guardianCtx, id);
  }
}
