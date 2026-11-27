import { createHash, timingSafeEqual } from "node:crypto";

import { BadRequestException, Controller, ForbiddenException, Get, Headers, HttpCode, Logger, NotFoundException, Post, Query, Req, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";

import { validMetaSignature } from "./meta-provider";
import { MetaWebhookService } from "./meta-webhook.service";

function tokenMatches(actual: unknown, expected: string | undefined): boolean {
  if (!expected || typeof actual !== "string" || actual.length > 512) return false;
  const digest = (token: string) => createHash("sha256").update(token).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

@Controller("webhooks/meta")
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);
  constructor(private readonly config: ConfigService, private readonly webhook: MetaWebhookService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  verify(@Query("hub.mode") mode: unknown, @Query("hub.verify_token") token: unknown, @Query("hub.challenge") challenge: unknown): string {
    this.assertEnabled();
    if (mode !== "subscribe" || !tokenMatches(token, this.config.get<string>("MESSAGING_META_VERIFY_TOKEN")) ||
        typeof challenge !== "string" || !/^\d{1,64}$/.test(challenge)) {
      throw new ForbiddenException("Meta verification failed");
    }
    return challenge;
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 200 } })
  async receive(@Req() request: Request & { rawBody?: Buffer }, @Headers("x-hub-signature-256") signature: unknown): Promise<{ ok: true }> {
    this.assertEnabled();
    const body = request.rawBody;
    if (!body || !validMetaSignature(body, signature, this.config.get<string>("MESSAGING_META_APP_SECRET"))) {
      throw new ForbiddenException("Invalid Meta signature");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      throw new BadRequestException("Invalid Meta payload");
    }
    try {
      await this.webhook.ingest(payload);
      return { ok: true };
    } catch {
      this.logger.error("Meta webhook inbox write failed");
      throw new ServiceUnavailableException("Meta webhook unavailable");
    }
  }

  private assertEnabled(): void {
    if (this.config.get<string>("MESSAGING_META_WEBHOOK_ENABLED") !== "on" ||
        !this.config.get<string>("MESSAGING_META_APP_SECRET") ||
        !this.config.get<string>("MESSAGING_META_VERIFY_TOKEN")) {
      throw new NotFoundException();
    }
  }
}
