import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { basePrisma, withTenant } from "@school-kit/db";
import { InternalError } from "@school-kit/types";

import { effectiveMessagingSpendLimit } from "../messaging-spend-limits";
import { messagingEmergencyState } from "../messaging-emergency-control";
import { reviewedMessagingRates } from "../../modules/notifications/messaging/messaging-review-controls";
import { countSmsSegments, quoteDispatchCost } from "../../modules/notifications/messaging/messaging-pricing";
import { parsePaidPlatformLimit, readVerifiedMessagingRates } from "../../modules/notifications/messaging/paid-messaging-policy";

// ---------------------------------------------------------------------------
// Termii SMS wrapper — Phase 4 / Slice 6 (D3). Mirrors PaystackService's
// structure: platform-wide credentials via ConfigService, checked lazily
// per-call (not at boot), thin fetch wrapper, no retries.
//
// API details confirmed against developers.termii.com (2026-07-18), not
// assumed — see docs/modules/phase-4.md §8 D6 for the full research note.
// ---------------------------------------------------------------------------

type SmsOutcome = { status: "ACCEPTED"; providerRef: string | null } | { status: "REJECTED" | "UNKNOWN"; reason: string };

interface TermiiSendResponse {
  code: string; // "ok" on success
  balance?: number;
  message_id?: string;
  message?: string;
  user?: string;
}

// Termii's base URL is per-account (dashboard-assigned), not a fixed global
// constant like Paystack's api.paystack.co — see phase-4.md §8 D6. This is
// the commonly-documented Nigeria-region default; TERMII_BASE_URL overrides
// it once the actual provisioned account's URL is known.
const DEFAULT_BASE_URL = "https://api.ng.termii.com";

// Guardian.phone has zero format validation (packages/types/src/guardians/
// create-guardian.dto.ts) — stored values may be local Nigerian format
// (0801...), international with or without a leading +, or malformed.
// Termii requires international format with NO leading + (e.g.
// 2347015250000). Returns null for anything that doesn't match a
// recognized Nigerian shape — callers must treat null as a send failure to
// log, not send a guessed value to Termii.
export function normalizeNigerianPhone(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    return `234${digits.slice(1)}`;
  }
  if (digits.length === 13 && digits.startsWith("234")) {
    return digits;
  }
  if (digits.length === 10) {
    // Local number with the leading 0 already stripped (rare, but seen in
    // free-text phone fields with no format enforcement).
    return `234${digits}`;
  }
  return null;
}

@Injectable()
export class TermiiService {
  private readonly logger = new Logger(TermiiService.name);
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    const key = config.get<string>("TERMII_API_KEY");
    if (!key || key === "replace-me") {
      this.logger.warn("TERMII_API_KEY is not configured — SMS sends will fail at runtime");
    }
    this.apiKey = key && key !== "replace-me" ? key : "";
    this.senderId = config.get<string>("TERMII_SENDER_ID") ?? "SchoolKit";
    this.baseUrl = config.get<string>("TERMII_BASE_URL") ?? DEFAULT_BASE_URL;
  }

  // Lets callers (FinanceService's reminder loop) check upfront whether SMS
  // is even attemptable, rather than throwing per-send when the key is
  // simply absent. Mirrors EmailService.isConfigured.
  get isConfigured(): boolean {
    return this.apiKey !== "";
  }

  // Sends one transactional SMS. `to` must already be normalized
  // (normalizeNigerianPhone) — this method does not normalize, so a
  // malformed number fails at Termii's end with a 4xx, not silently.
  //
  // channel: "dnd" (transactional), not "generic" (promotional-only —
  // Termii's own docs warn generic silently fails DND-registered numbers
  // and shouldn't carry OTP/transactional content). Every message this
  // slice sends (invite links, fee reminders) is transactional.
  //
  // senderId: the school's own APPROVED sender name (smsSenderFor in
  // modules/schools/sms-sender.service.ts), else the platform's
  // TERMII_SENDER_ID (docs/modules/school-identity.md slice 2).
  async sendSms(to: string, message: string, senderId?: string): Promise<void> {
    const outcome = await this.sendSmsWithOutcome(to, message, senderId);
    if (outcome.status !== "ACCEPTED") throw new InternalError("Termii SMS did not complete.");
  }

  /**
   * One SMS, with the outcome classified rather than thrown (2026-11-09,
   * docs/modules/reminder-campaigns.md). REJECTED means Termii answered and
   * did not take the message; UNKNOWN means we cannot tell (network failure,
   * timeout, a 5xx after the request left), and the campaign never retries
   * it automatically. Termii's API offers no idempotency key that SchoolKit
   * has verified, so none is sent. Logs carry no number or text.
   */
  async sendSmsWithOutcome(
    to: string,
    message: string,
    senderId?: string,
  ): Promise<SmsOutcome> {
    if (!this.apiKey) return { status: "REJECTED", reason: "SMS_NOT_CONFIGURED" };
    if (!(await this.reservePlatformSpend(message))) return { status: "REJECTED", reason: "PLATFORM_SMS_BUDGET_UNAVAILABLE" };
    return this.requestSms(to, message, senderId);
  }

  async sendWalletReservedSms(
    schoolId: string, deliveryId: string, to: string, message: string, senderId?: string,
  ): Promise<SmsOutcome> {
    if (!this.apiKey || this.config.get<string>("MESSAGING_PAID_ENABLED") !== "on") {
      return { status: "REJECTED", reason: "SMS_NOT_CONFIGURED" };
    }
    const reserved = await withTenant(schoolId, async (db) => {
      const [claim] = await db.$queryRaw<{ id: string }[]>`
        UPDATE notification_deliveries d SET dispatch_reason = 'PROVIDER_STARTED'
        WHERE d.school_id = ${schoolId} AND d.id = ${deliveryId} AND d.channel = 'SMS'
          AND d.dispatch_state = 'SENDING' AND d.dispatch_reason IS NULL
          AND EXISTS (SELECT 1 FROM messaging_wallet_entries w
            WHERE w.school_id = ${schoolId} AND w.reference = 'notification:' || d.id AND w.kind = 'RESERVE')
          AND NOT EXISTS (SELECT 1 FROM messaging_wallet_entries w
            WHERE w.school_id = ${schoolId} AND w.reference = 'notification:' || d.id AND w.kind IN ('SETTLE', 'RELEASE'))
        RETURNING d.id`;
      return !!claim;
    });
    if (!reserved) return { status: "REJECTED", reason: "SMS_RESERVATION_REQUIRED" };
    return this.requestSms(to, message, senderId);
  }

  private async reservePlatformSpend(message: string): Promise<boolean> {
    if (this.config.get<string>("MESSAGING_LEGACY_SMS_ENABLED") !== "on") return false;
    const configuredLimit = parsePaidPlatformLimit(this.config.get<string>("MESSAGING_PAID_PLATFORM_DAILY_KOBO"));
    if (!configuredLimit || (await messagingEmergencyState("SMS")).stopped) return false;
    const limit = await effectiveMessagingSpendLimit("platform", configuredLimit);
    const units = countSmsSegments(message);
    if (!limit || !units) return false;
    const rates = await reviewedMessagingRates("platform", readVerifiedMessagingRates(this.config.get<string>("MESSAGING_LEGACY_SMS_RATES")));
    const cost = quoteDispatchCost(rates, "TERMII_SMS", "SCHOOLKIT", units, new Date());
    if (!cost || cost.walletKobo > limit) return false;
    const { walletKobo } = cost;
    return !!(await basePrisma.$executeRaw`
      INSERT INTO messaging_platform_reservations_daily (day, reserved_kobo)
      VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date, ${walletKobo}::bigint)
      ON CONFLICT (day) DO UPDATE SET reserved_kobo =
        messaging_platform_reservations_daily.reserved_kobo + EXCLUDED.reserved_kobo
      WHERE messaging_platform_reservations_daily.reserved_kobo + EXCLUDED.reserved_kobo <= ${limit}::bigint`);
  }

  private async requestSms(to: string, message: string, senderId?: string): Promise<SmsOutcome> {
    if ((await messagingEmergencyState("SMS")).stopped) return { status: "REJECTED", reason: "SMS_EMERGENCY_STOP" };
    if (!this.apiKey) return { status: "REJECTED", reason: "SMS_NOT_CONFIGURED" };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/sms/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: this.apiKey, to, from: senderId ?? this.senderId, sms: message, type: "plain", channel: "dnd" }),
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
    } catch {
      this.logger.warn("Termii send uncertain: no answer");
      return { status: "UNKNOWN", reason: "PROVIDER_NO_ANSWER" };
    }
    if (res.status >= 500) {
      this.logger.warn(`Termii send uncertain: HTTP ${res.status}`);
      return { status: "UNKNOWN", reason: `PROVIDER_HTTP_${res.status}` };
    }
    if (!res.ok) {
      this.logger.warn(`Termii send refused: HTTP ${res.status}`);
      return { status: "REJECTED", reason: `PROVIDER_HTTP_${res.status}` };
    }
    const json = (await res.json().catch(() => null)) as TermiiSendResponse | null;
    if (!json) return { status: "UNKNOWN", reason: "PROVIDER_UNREADABLE_ANSWER" };
    if (json.code !== "ok") {
      this.logger.warn("Termii send refused: not ok");
      return { status: "REJECTED", reason: "PROVIDER_REFUSED" };
    }
    return { status: "ACCEPTED", providerRef: json.message_id ?? null };
  }
}
