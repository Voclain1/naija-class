import { CanActivate, ExecutionContext, Injectable, type RawBodyRequest } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedError } from "@school-kit/types";
import type { Request } from "express";

import { readPaystackSigningKeys, verifyModernPaystackSignature } from "./paystack-signature.js";
import { PaystackService } from "./paystack.service.js";

@Injectable()
export class PaystackWebhookGuard implements CanActivate {
  constructor(private readonly paystack: PaystackService, private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const rawBody = req.rawBody;
    if (!rawBody?.length) throw new UnauthorizedError("MISSING_RAW_BODY", "Raw webhook body is unavailable.");

    const mode = this.config.get<string>("PAYSTACK_WEBHOOK_MODE");
    const modern = req.headers["paystack-signature"];
    if (modern !== undefined) {
      // The receiving endpoint has a single configured mode. A signed body
      // or a header value supplied by the sender cannot select the keyring.
      const keyring = mode === "live" ? "PAYSTACK_WEBHOOK_LIVE_KEYS" : mode === "test" ? "PAYSTACK_WEBHOOK_TEST_KEYS" : undefined;
      if (keyring && verifyModernPaystackSignature(rawBody, modern, readPaystackSigningKeys(this.config.get(keyring)))) return true;
    } else if (this.config.get<string>("PAYSTACK_WEBHOOK_REQUIRE_MODERN") !== "on") {
      const legacy = req.headers["x-paystack-signature"];
      const apiKey = this.config.get<string>("PAYSTACK_SECRET_KEY");
      const matchesMode = !mode || (mode === "live" && apiKey?.startsWith("sk_live_")) ||
        (mode === "test" && apiKey?.startsWith("sk_test_"));
      // Transitional compatibility. Never run this branch after a modern
      // header was supplied, including malformed or unknown key IDs.
      if (matchesMode && apiKey && typeof legacy === "string" && /^[0-9a-f]{128}$/.test(legacy) &&
          this.paystack.verifyWebhookSignature(rawBody, legacy)) return true;
    }

    throw new UnauthorizedError("INVALID_PAYSTACK_SIGNATURE", "Paystack webhook signature verification failed.");
  }
}
