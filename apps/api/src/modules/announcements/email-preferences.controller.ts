import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import type { Request } from "express";

import {
  emailUnsubscribeQuerySchema,
  emailUnsubscribeSchema,
  portalEmailPreferencesSchema,
  type EmailUnsubscribeInput,
  type EmailUnsubscribeQuery,
  type EmailUnsubscribeStatusDto,
  type PortalEmailPreferencesDto,
  type PortalEmailPreferencesInput,
} from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { EmailPreferencesService } from "./email-preferences.service.js";

// Phase 9 / CP8.3 (docs/modules/phase-9.md §17.11).

/**
 * The unsubscribe link in every announcement email. PUBLIC, like the result
 * checker: the token in the link is the proof. `one-click` is what a mail
 * app POSTs to from the List-Unsubscribe header (RFC 8058), with the same
 * three values in the query string.
 */
@Controller("email/unsubscribe")
export class EmailUnsubscribeController {
  constructor(private readonly service: EmailPreferencesService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  status(@Query(new ZodValidationPipe(emailUnsubscribeQuerySchema)) q: EmailUnsubscribeQuery): Promise<EmailUnsubscribeStatusDto> {
    return this.service.status(q);
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  set(@Body(new ZodValidationPipe(emailUnsubscribeSchema)) dto: EmailUnsubscribeInput, @Ip() ip: string): Promise<EmailUnsubscribeStatusDto> {
    return this.service.set(dto, { ipAddress: ip });
  }

  @Post("one-click")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async oneClick(@Query(new ZodValidationPipe(emailUnsubscribeQuerySchema)) q: EmailUnsubscribeQuery, @Ip() ip: string): Promise<{ ok: true }> {
    await this.service.set({ ...q, subscribe: false }, { ipAddress: ip });
    return { ok: true };
  }
}

/** A signed-in parent's own switch for announcement emails. */
@Controller("portal/email-preferences")
@UseGuards(GuardianAuthGuard)
export class PortalEmailPreferencesController {
  constructor(private readonly service: EmailPreferencesService) {}

  @Get()
  get(@CurrentGuardian() g: GuardianAuthContext): Promise<PortalEmailPreferencesDto> {
    return this.service.portalGet(g);
  }

  // POST, not PUT: the portal's proxy forwards GET and POST only.
  @Post()
  @HttpCode(200)
  set(
    @CurrentGuardian() g: GuardianAuthContext,
    @Body(new ZodValidationPipe(portalEmailPreferencesSchema)) dto: PortalEmailPreferencesInput,
    @Ip() ip: string,
  ): Promise<PortalEmailPreferencesDto> {
    return this.service.portalSet(g, dto, { ipAddress: ip });
  }
}

/** Resend's delivery reports. Signed; no session. */
@Controller("webhooks/resend")
export class ResendWebhookController {
  constructor(private readonly service: EmailPreferencesService) {}

  // Resend sends a burst of reports from a few addresses after a big send;
  // the per-address limit would turn them away. The signature is the gate.
  @Post()
  @SkipThrottle()
  @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>): Promise<{ ok: true }> {
    await this.service.webhook(req.rawBody, headers);
    return { ok: true };
  }
}
