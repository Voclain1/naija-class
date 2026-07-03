import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";

import { UnauthorizedError } from "@school-kit/types";

import { PaystackService } from "./paystack.service.js";

// Guards the Paystack webhook endpoint.
//
// Paystack signs every webhook delivery with HMAC-SHA512 over the raw request
// body, sending the hex digest in the `x-paystack-signature` header. We must
// verify this BEFORE acting on the event — it is the only authentication on an
// otherwise public endpoint.
//
// IMPORTANT: rawBody: true must be set in NestFactory.create() so that
// req.rawBody is populated before JSON parsing occurs. Without the raw bytes
// we cannot reproduce the HMAC Paystack computed. The guard fails closed: if
// req.rawBody is absent or the signature is missing / invalid, it throws
// UnauthorizedException.

@Injectable()
export class PaystackWebhookGuard implements CanActivate {
  constructor(private readonly paystack: PaystackService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const signature = req.headers["x-paystack-signature"];
    if (!signature || typeof signature !== "string") {
      throw new UnauthorizedError(
        "MISSING_PAYSTACK_SIGNATURE",
        "Paystack webhook signature is missing.",
      );
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new UnauthorizedError(
        "MISSING_RAW_BODY",
        "Raw body not available for signature verification.",
      );
    }

    let valid: boolean;
    try {
      valid = this.paystack.verifyWebhookSignature(rawBody, signature);
    } catch {
      // timingSafeEqual throws if the two buffers differ in length (e.g. a
      // non-hex signature produces a different-length buffer). Treat as invalid.
      valid = false;
    }

    if (!valid) {
      throw new UnauthorizedError(
        "INVALID_PAYSTACK_SIGNATURE",
        "Paystack webhook signature verification failed.",
      );
    }

    return true;
  }
}
