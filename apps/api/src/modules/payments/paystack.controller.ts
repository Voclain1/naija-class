import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  initPaystackPaymentSchema,
  type InitPaystackPaymentInput,
  type PaymentDto,
  type PaystackInitResponseDto,
  type PaystackWebhookEvent,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { PaystackWebhookGuard } from "../../common/paystack/paystack-webhook.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { PayrollService } from "../payroll/payroll.service.js";
import { PaymentsService } from "./payments.service.js";

// Paystack-specific endpoints are on a SEPARATE controller (not a sub-route of
// PaymentsController) because PaymentsController has class-level @UseGuards
// (AuthGuard + PermissionsGuard). NestJS method-level guards ADD to class-level
// guards; they do not replace them. The webhook endpoint needs only the
// PaystackWebhookGuard (signature verification) — adding AuthGuard would cause
// Paystack's server-to-server POST to fail authentication. Separating the
// controller is the only clean solution.

@Controller("payments/paystack")
export class PaystackController {
  constructor(
    private readonly service: PaymentsService,
    private readonly payrollService: PayrollService,
  ) {}

  // POST /payments/paystack/init
  // Initiates a Paystack inline checkout. Returns an authorization_url for the
  // frontend to redirect to. Creates a PENDING payment row.
  @Post("init")
  @HttpCode(200)
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions("payment.record")
  async initPayment(
    @Body(new ZodValidationPipe(initPaystackPaymentSchema)) dto: InitPaystackPaymentInput,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<PaystackInitResponseDto> {
    return this.service.initPaystack(authCtx, dto);
  }

  // POST /payments/paystack/webhook
  // Receives Paystack webhook events. Always returns 200 — non-2xx triggers
  // Paystack retries. Authenticated via HMAC-SHA512 signature (PaystackWebhookGuard);
  // no user session required.
  //
  // Routes by event-name prefix: charge.* events are student-fee payments
  // (PaymentsService), transfer.* events are staff salary payouts
  // (PayrollService, added CP4b). Same webhook endpoint for both — Paystack
  // sends every event type to the one URL configured in the dashboard.
  @Post("webhook")
  @HttpCode(200)
  @UseGuards(PaystackWebhookGuard)
  async handleWebhook(@Body() event: PaystackWebhookEvent): Promise<{ status: string }> {
    if (event.event.startsWith("transfer.")) {
      await this.payrollService.handleTransferWebhook(event);
    } else {
      await this.service.handleWebhook(event);
    }
    return { status: "ok" };
  }

  // GET /payments/paystack/verify/:reference
  // Self-heal endpoint: if the webhook was not delivered (e.g. the API restarted
  // during checkout), the frontend calls this to pull the latest status from
  // Paystack and apply it locally. Authenticated as a normal user action.
  @Get("verify/:reference")
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions("payment.read")
  async verifyPayment(
    @Param("reference") reference: string,
    @CurrentUser() authCtx: AuthContext,
  ): Promise<PaymentDto> {
    return this.service.verifyPaystack(authCtx, reference);
  }
}
