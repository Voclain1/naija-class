import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import type { PortalStudentTransportDto } from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { TransportService } from "./transport.service.js";

// Phase 9 / CP5.3 — a guardian reads their own child's school bus this term:
// the route, stop, pickup time, driver's name and phone, and the plate
// (docs/modules/phase-9.md §13 CP5-D10). Behind withGuardian. null when the
// child has no place this term.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalTransportController {
  constructor(private readonly service: TransportService) {}

  @Get("students/:id/transport")
  transport(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<PortalStudentTransportDto | null> {
    return this.service.transportForGuardian(guardianCtx, id);
  }
}
