import { Controller, HttpCode, Ip, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { PaystackInitResponseDto, PortalPaymentDto } from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard";
import { PortalPaymentsService } from "./portal-payments.service";

// Phase 4 / Slice 5 — kept as its own module, not grown inside
// portal-finance: payment initiation is a write/money-movement action,
// a different risk class from the read-only invoice listing that module
// covers, same reasoning admin-side keeps PaystackController separate
// from InvoicesController.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalPaymentsController {
  constructor(private readonly service: PortalPaymentsService) {}

  @Post("students/:id/invoices/:invoiceId/pay")
  @HttpCode(200)
  async initiate(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id") studentId: string,
    @Param("invoiceId") invoiceId: string,
    @Ip() ip: string,
  ): Promise<PaystackInitResponseDto> {
    return this.service.initiate(guardianCtx, studentId, invoiceId, { ipAddress: ip });
  }

  @Get("payments/:reference")
  async verify(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("reference") reference: string,
  ): Promise<PortalPaymentDto> {
    return this.service.verify(guardianCtx, reference);
  }
}
