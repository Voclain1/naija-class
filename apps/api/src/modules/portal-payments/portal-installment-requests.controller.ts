import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { installmentProposalSchema, type CreateInstallmentInput } from "@school-kit/types";
import { z } from "zod";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { InstallmentRequestsService } from "../payments/installment-requests.service.js";

const respondSchema = z.object({ accept: z.boolean(), revision: z.number().int().positive() }).strict();

@Controller("portal/students/:studentId/invoices/:invoiceId/installment-requests")
@UseGuards(GuardianAuthGuard)
export class PortalInstallmentRequestsController {
  constructor(private readonly service: InstallmentRequestsService) {}

  @Get()
  list(@CurrentGuardian() ctx: GuardianAuthContext, @Param("studentId") studentId: string, @Param("invoiceId") invoiceId: string) {
    return this.service.guardianView(ctx, studentId, invoiceId);
  }

  @Post()
  submit(
    @CurrentGuardian() ctx: GuardianAuthContext,
    @Param("studentId") studentId: string,
    @Param("invoiceId") invoiceId: string,
    @Body(new ZodValidationPipe(installmentProposalSchema)) schedule: CreateInstallmentInput[],
  ) {
    return this.service.submit(ctx, studentId, invoiceId, schedule);
  }

  @Post(":requestId/respond")
  respond(
    @CurrentGuardian() ctx: GuardianAuthContext,
    @Param("studentId") studentId: string,
    @Param("invoiceId") invoiceId: string,
    @Param("requestId") requestId: string,
    @Body(new ZodValidationPipe(respondSchema)) response: z.infer<typeof respondSchema>,
  ) {
    return this.service.respond(ctx, studentId, invoiceId, requestId, response.revision, response.accept);
  }
}
