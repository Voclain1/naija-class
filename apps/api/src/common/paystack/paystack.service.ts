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

export interface PaystackRefundData {
  id: number;         // Paystack refund ID
  amount: number;     // kobo
  status: string;
  transaction: string; // Paystack transaction reference
}

interface PaystackRefundResponse {
  status: boolean;
  message: string;
  data: PaystackRefundData;
}

// ---------------------------------------------------------------------------
// Payroll CP4 — bank account resolution, transfer recipients, transfers,
// balance check. Paystack API response shapes (only the fields we use).
// ---------------------------------------------------------------------------

export interface PaystackResolvedAccount {
  account_number: string;
  account_name: string;
  bank_id: number;
}

interface PaystackResolveResponse {
  status: boolean;
  message: string;
  data: PaystackResolvedAccount;
}

export interface PaystackTransferRecipientData {
  recipient_code: string;
  active: boolean;
}

interface PaystackTransferRecipientResponse {
  status: boolean;
  message: string;
  data: PaystackTransferRecipientData;
}

export interface PaystackTransferData {
  transfer_code: string;
  status: string; // "pending" | "success" | "otp" | ...
  reference: string;
  amount: number; // kobo
}

interface PaystackTransferResponse {
  status: boolean;
  message: string;
  data: PaystackTransferData;
}

export interface PaystackBalance {
  currency: string;
  balance: number; // kobo
}

interface PaystackBalanceResponse {
  status: boolean;
  message: string;
  data: PaystackBalance[];
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

  // ─── Refund transaction ───────────────────────────────────────────────────

  // Calls Paystack POST /refund to return money to the payer.
  // reference: the original transaction reference ("PSK-{schoolId}-{paymentId}").
  // amount: refund amount in kobo (must equal payment amount — partial refunds
  //   are not supported in slice 11).
  // Returns the Paystack refund object whose `id` is stored as paystackRefundRef.
  async refundTransaction(reference: string, amount: number): Promise<PaystackRefundData> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured on this server");
    }
    const res = await fetch(`${this.baseUrl}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transaction: reference, amount }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      this.logger.error(`Paystack refund failed: ${res.status} ${text}`);
      throw new Error(`Paystack refund failed (HTTP ${res.status}): ${text}`);
    }

    const json = (await res.json()) as PaystackRefundResponse;
    if (!json.status) {
      this.logger.error(`Paystack refund rejected: ${json.message}`);
      throw new Error(`Paystack refund rejected: ${json.message}`);
    }

    return json.data;
  }

  // ─── Payroll CP4: resolve account, create recipient, transfer, balance ────

  // Resolves an account number + bank code to the bank's own record of the
  // account holder's name. Callers (StaffBankAccountService) use this TWICE:
  // once for the operator-facing "verify" preview, and again server-side at
  // create time to independently re-derive the name rather than trusting
  // whatever the client echoes back — never trust a client-supplied value
  // for something this consequential.
  async resolveAccount(accountNumber: string, bankCode: string): Promise<PaystackResolvedAccount> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured on this server");
    }
    const params = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
    const res = await fetch(`${this.baseUrl}/bank/resolve?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      this.logger.error(`Paystack account resolve failed: ${res.status} ${text}`);
      throw new InternalError(
        "PAYSTACK_RESOLVE_FAILED",
        `Could not resolve this account number (HTTP ${res.status}). Check the bank and account number.`,
      );
    }

    const json = (await res.json()) as PaystackResolveResponse;
    if (!json.status) {
      this.logger.error(`Paystack account resolve rejected: ${json.message}`);
      throw new InternalError("PAYSTACK_RESOLVE_FAILED", json.message);
    }

    return json.data;
  }

  // Creates a Paystack Transfer Recipient — eager, at bank-account-save time
  // (plan-first D2), not lazily at first transfer. A bad account surfaces
  // here, during the low-stakes "add bank details" step, not later during a
  // time-pressured payroll run.
  async createTransferRecipient(params: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<PaystackTransferRecipientData> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured on this server");
    }
    const res = await fetch(`${this.baseUrl}/transferrecipient`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "nuban",
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: "NGN",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      this.logger.error(`Paystack recipient creation failed: ${res.status} ${text}`);
      throw new InternalError(
        "PAYSTACK_RECIPIENT_FAILED",
        `Could not register this bank account with Paystack (HTTP ${res.status}).`,
      );
    }

    const json = (await res.json()) as PaystackTransferRecipientResponse;
    if (!json.status) {
      this.logger.error(`Paystack recipient creation rejected: ${json.message}`);
      throw new InternalError("PAYSTACK_RECIPIENT_FAILED", json.message);
    }

    return json.data;
  }

  // GET /balance — the pre-flight check every transfer must pass (plan-first
  // D3). Returns the NGN balance in kobo. This is the PLATFORM's single
  // shared Paystack balance, not a per-school balance — see the CP3/CP4
  // plan-firsts' documented interim-state decision.
  async getBalance(): Promise<PaystackBalance> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured on this server");
    }
    const res = await fetch(`${this.baseUrl}/balance`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      this.logger.error(`Paystack balance check failed: ${res.status} ${text}`);
      throw new InternalError(
        "PAYSTACK_BALANCE_FAILED",
        `Could not check the Paystack balance (HTTP ${res.status}).`,
      );
    }

    const json = (await res.json()) as PaystackBalanceResponse;
    if (!json.status) {
      this.logger.error(`Paystack balance check rejected: ${json.message}`);
      throw new InternalError("PAYSTACK_BALANCE_FAILED", json.message);
    }

    const ngn = json.data.find((b) => b.currency === "NGN");
    if (!ngn) {
      throw new InternalError("PAYSTACK_BALANCE_FAILED", "No NGN balance returned by Paystack.");
    }
    return ngn;
  }

  // POST /transfer — initiates a transfer from the platform's balance to a
  // previously-created recipient. reference: "PST-{schoolId}-{payrollItemId}",
  // mirroring parsePaystackReference's existing "PSK-{schoolId}-{paymentId}"
  // convention so the webhook handler can route without a lookup table.
  async initiateTransfer(params: {
    amount: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }): Promise<PaystackTransferData> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured on this server");
    }
    const res = await fetch(`${this.baseUrl}/transfer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        amount: params.amount,
        recipient: params.recipientCode,
        reference: params.reference,
        reason: params.reason,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      this.logger.error(`Paystack transfer initiation failed: ${res.status} ${text}`);
      throw new InternalError(
        "PAYSTACK_TRANSFER_FAILED",
        `Paystack transfer initiation failed (HTTP ${res.status}).`,
      );
    }

    const json = (await res.json()) as PaystackTransferResponse;
    if (!json.status) {
      this.logger.error(`Paystack transfer initiation rejected: ${json.message}`);
      throw new InternalError("PAYSTACK_TRANSFER_FAILED", json.message);
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
