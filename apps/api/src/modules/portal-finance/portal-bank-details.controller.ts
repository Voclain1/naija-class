import { Controller, Get, UseGuards } from "@nestjs/common";
import type { PortalBankDetailsResponse } from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard";
import { PortalBankDetailsService } from "./portal-bank-details.service";

// Guardian-only. Deliberately NOT exposed on the student portal: the request
// was for parents, and a child has no use for the school's account number.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalBankDetailsController {
  constructor(private readonly service: PortalBankDetailsService) {}

  @Get("bank-details")
  async get(@CurrentGuardian() guardianCtx: GuardianAuthContext): Promise<PortalBankDetailsResponse> {
    return this.service.getForGuardian(guardianCtx);
  }
}
