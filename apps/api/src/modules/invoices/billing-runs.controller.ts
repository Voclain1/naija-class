import { Body, Controller, Get, Ip, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  approveBillingRunSchema, billingRequestSchema, billingRunInputSchema,
  type BillingRequestInput, type BillingRunInput,
} from "@school-kit/types";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { BillingRunsService } from "./billing-runs.service.js";

@Controller("assistant/billing")
@UseGuards(AuthGuard, PermissionsGuard)
export class BillingRunsController {
  constructor(private readonly service: BillingRunsService) {}

  @Get("availability")
  @Permissions("invoice.read")
  available(@CurrentUser() auth: AuthContext) { return this.service.available(auth); }

  @Get("context")
  @Permissions("invoice.read")
  context(@CurrentUser() auth: AuthContext) { return this.service.context(auth); }

  @Get("runs")
  @Permissions("invoice.read")
  list(@CurrentUser() auth: AuthContext) { return this.service.list(auth); }

  @Post("request")
  @Permissions("invoice.read")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  request(@CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(billingRequestSchema)) body: BillingRequestInput, @Ip() ip: string) {
    return this.service.request(auth, body, ip);
  }

  @Post("runs")
  @Permissions("invoice.read")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  prepare(@CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(billingRunInputSchema)) body: BillingRunInput, @Ip() ip: string) {
    return this.service.prepare(auth, body, ip);
  }

  @Get("runs/:id")
  @Permissions("invoice.read")
  get(@CurrentUser() auth: AuthContext, @Param("id") id: string) { return this.service.get(auth, id); }

  @Post("runs/:id/approve")
  @Permissions("invoice.read", "invoice.issue")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  approve(@CurrentUser() auth: AuthContext, @Param("id") id: string,
    @Body(new ZodValidationPipe(approveBillingRunSchema)) body: { previewHash: string }, @Ip() ip: string) {
    return this.service.approve(auth, id, body.previewHash, ip);
  }
}
