import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { PortalInvoiceListResponse } from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard";
import { PortalInvoicesService } from "./portal-invoices.service";

// Phase 4 / Slice 4 — kept as its own module rather than grown inside
// PortalStudentsModule: invoices are a different bounded concern (finance,
// not roster) even though nested under the same /portal/students/:id URL
// family, same reasoning admin-side InvoicesModule stays separate from
// StudentsModule.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalInvoicesController {
  constructor(private readonly service: PortalInvoicesService) {}

  @Get("students/:id/invoices")
  async listForStudent(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") id: string,
  ): Promise<PortalInvoiceListResponse> {
    return this.service.listForStudent(guardianCtx, id);
  }
}
