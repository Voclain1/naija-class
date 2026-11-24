import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";

import { CurrentGuardian } from "../../../common/auth/current-guardian.decorator";
import type { GuardianAuthContext } from "../../../common/auth/guardian-auth-context";
import { GuardianAuthGuard } from "../../../common/auth/guardian-auth.guard";
import { ZodValidationPipe } from "../../../common/zod-validation.pipe";
import {
  GuardianMessagingConsentService, WHATSAPP_CONSENT_VERSION, WHATSAPP_CONSENT_WORDING,
} from "./guardian-messaging-consent.service";

const consentSchema = z.object({ consentVersion: z.string().max(60) }).strict();

@Controller("portal/messaging/whatsapp-consent")
@UseGuards(GuardianAuthGuard)
export class GuardianMessagingConsentController {
  constructor(private readonly consents: GuardianMessagingConsentService) {}

  @Get()
  async get(@CurrentGuardian() auth: GuardianAuthContext) {
    const verified = await this.consents.verifiedRecipient(auth.schoolId, auth.guardianId);
    return { version: WHATSAPP_CONSENT_VERSION, wording: WHATSAPP_CONSENT_WORDING, granted: verified !== null };
  }

  @Post("challenge")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  challenge(
    @CurrentGuardian() auth: GuardianAuthContext,
    @Body(new ZodValidationPipe(consentSchema)) body: { consentVersion: string },
  ) {
    return this.consents.createChallenge(auth, body.consentVersion);
  }

  @Post("withdraw")
  @HttpCode(204)
  withdraw(@CurrentGuardian() auth: GuardianAuthContext) {
    return this.consents.withdraw(auth);
  }
}
