import * as crypto from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { InternalError } from "@school-kit/types";

// ---------------------------------------------------------------------------
// Paystack API response shapes (only the fields we use)
// ---------------------------------------------------------------------------

interface PaystackInitData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: PaystackInitData;
}

export interface PaystackVerifyData {
  status: string; // "success" | "failed" | "abandoned" | "pending" | ...
  reference: string;
  amount: number; // in kobo
  paid_at: string | null; // ISO 8601
  metadata: unknown;
  channel: string;
  currency: string;
  fees: number | null;
  customer: { email: string };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: PaystackVerifyData;
}

// ---------------------------------------------------------------------------
// Params for initializeTransaction
// ---------------------------------------------------------------------------

export interface PaystackInitParams {
  amount: number; // kobo
  email: string;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly secretKey: string;
  private readonly baseUrl = "https://api.paystack.co";

  constructor(private readonly config: ConfigService) {
    const key = config.get<string>("PAYSTACK_SECRET_KEY");
    if (!key) {
      this.logger.warn("PAYSTACK_SECRET_KEY is not set — Paystack payments will fail at runtime");
    }
    this.secretKey = key ?? "";
  }

  // ─── Initialize transaction ────────────────────────────────────────────────

  async initializeTransaction(params: PaystackInitParams): Promise<PaystackInitData> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured on this server");
    }
    const body: Record<string, unknown> = {
      amount: params.amount,
      email: params.email,
      reference: params.reference,
    };
    if (params.callbackUrl) body.callback_url = params.callbackUrl;
    if (params.metadata) body.metadata = params.metadata;

    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      this.logger.error(`Paystack init failed: ${res.status} ${text}`);
      throw new InternalError(
        "PAYSTACK_INIT_FAILED",
        `Paystack transaction initialization failed (HTTP ${res.status}).`,
      );
    }

    const json = (await res.json()) as PaystackInitResponse;
    if (!json.status) {
      this.logger.error(`Paystack init rejected: ${json.message}`);
      throw new InternalError("PAYSTACK_INIT_FAILED", json.message);
    }

    return json.data;
  }

  // ─── Verify transaction ────────────────────────────────────────────────────

  async verifyTransaction(reference: string): Promise<PaystackVerifyData> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured on this server");
    }
    const encodedRef = encodeURIComponent(reference);
    const res = await fetch(`${this.baseUrl}/transaction/verify/${encodedRef}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      this.logger.error(`Paystack verify failed: ${res.status} ${text}`);
      throw new InternalError(
        "PAYSTACK_VERIFY_FAILED",
        `Paystack transaction verification failed (HTTP ${res.status}).`,
      );
    }

    const json = (await res.json()) as PaystackVerifyResponse;
    if (!json.status) {
      this.logger.error(`Paystack verify rejected: ${json.message}`);
      throw new InternalError("PAYSTACK_VERIFY_FAILED", json.message);
    }

    return json.data;
  }

  // ─── Webhook signature verification (pure — no network) ───────────────────

  // Returns true if the HMAC-SHA512 of rawBody matches the header value.
  // Call this BEFORE parsing the body. Fails closed: missing key → false.
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const hmac = crypto
      .createHmac("sha512", this.secretKey)
      .update(rawBody)
      .digest("hex");
    // Constant-time comparison to prevent timing attacks.
    return crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(signature, "hex"));
  }
}
