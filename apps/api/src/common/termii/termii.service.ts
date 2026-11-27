import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { basePrisma, type PrismaClient, withTenant } from "@school-kit/db";
import { InternalError } from "@school-kit/types";

import { effectiveMessagingSpendLimit } from "../messaging-spend-limits";
import { messagingEmergencyState } from "../messaging-emergency-control";
import { messagingProviderActivation, reviewedMessagingRates } from "../../modules/notifications/messaging/messaging-review-controls";
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

export interface LegacySmsAttribution {
  schoolId: string;
  eventType: "ADMISSION" | "PARENT_MESSAGE" | "GUARDIAN_INVITATION" | "SICKBAY" |
    "FEE_REMINDER" | "REMINDER_CAMPAIGN" | "HOSTEL_EXEAT" | "DISCIPLINE";
  eventId: string;
  approvedUnitKobo?: number | null;
}

const LEGACY_SMS_PRODUCERS: readonly string[] = [
  "ADMISSION", "PARENT_MESSAGE", "GUARDIAN_INVITATION", "SICKBAY",
  "FEE_REMINDER", "REMINDER_CAMPAIGN", "HOSTEL_EXEAT", "DISCIPLINE",
];

@Injectable()
export class TermiiService implements OnApplicationBootstrap {
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

  async onApplicationBootstrap(): Promise<void> {
    if (!this.isConfigured || this.config.get("NODE_ENV") !== "production") return;
    const migration = this.config.get("MESSAGING_LEGACY_SMS_MIGRATION_MODE");
    const release = this.config.get("MESSAGING_LEGACY_SMS_ENABLED") === "on";
    if (migration === "off" && !release) return;
    if (!release && migration !== "existing-authorized") {
      throw new Error("Choose and validate an explicit legacy SMS release or an intentional legacy SMS shutdown.");
    }
    const limits = parsePaidPlatformLimit(this.config.get<string>("MESSAGING_PAID_PLATFORM_DAILY_KOBO"));
    const rates = await reviewedMessagingRates("platform", readVerifiedMessagingRates(this.config.get<string>("MESSAGING_LEGACY_SMS_RATES")));
    const cost = quoteDispatchCost(rates, "TERMII_SMS", "SCHOOLKIT", 1, new Date());
    const configured = this.legacyAuthorizations();
    if (!cost || cost.walletKobo > await effectiveMessagingSpendLimit("platform", limits) ||
        configured.length === 0 || configured.some(({ cap }) => cap < cost.walletKobo)) {
      throw new Error("Legacy SMS release requires valid school and producer authorizations, spending ceilings and an effective verified rate.");
    }
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
  async sendSms(to: string, message: string, senderId?: string, attribution?: LegacySmsAttribution): Promise<void> {
    const outcome = await this.sendSmsWithOutcome(to, message, senderId, attribution);
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
    attribution?: LegacySmsAttribution,
  ): Promise<SmsOutcome> {
    if (!this.apiKey) return { status: "REJECTED", reason: "SMS_NOT_CONFIGURED" };
    if (!(await this.reservePlatformSpend(message, attribution))) return { status: "REJECTED", reason: "PLATFORM_SMS_BUDGET_UNAVAILABLE" };
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

  private legacyAuthorizations(): { schoolId: string; producers: string[]; cap: bigint }[] {
    try {
      const inputs = JSON.parse(this.config.get<string>("MESSAGING_LEGACY_SMS_AUTHORIZATIONS") ?? "{}") as
        Record<string, { producers?: unknown; dailyKobo?: unknown } | null>;
      return Object.entries(inputs).flatMap(([schoolId, input]) => {
        const producers = input?.producers;
        if (!Array.isArray(producers) || !producers.length ||
            !producers.every((value) => typeof value === "string" && LEGACY_SMS_PRODUCERS.includes(value)) ||
            typeof input?.dailyKobo !== "string") return [];
        const cap = parsePaidPlatformLimit(input.dailyKobo);
        return cap > 0n ? [{ schoolId, producers, cap }] : [];
      });
    } catch {
      return [];
    }
  }

  private legacyAuthorization(schoolId: string, eventType?: LegacySmsAttribution["eventType"]): bigint | undefined {
    return this.legacyAuthorizations().find((entry) =>
      entry.schoolId === schoolId && (!eventType || entry.producers.includes(eventType)))?.cap;
  }

  async legacyReadiness(schoolId?: string, eventType?: LegacySmsAttribution["eventType"]) {
    const release: "on" | "existing-authorized" | "off" = this.config.get<string>("MESSAGING_LEGACY_SMS_ENABLED") === "on" ? "on"
      : this.config.get<string>("MESSAGING_LEGACY_SMS_MIGRATION_MODE") === "existing-authorized" ? "existing-authorized"
      : "off";
    const configuredLimit = parsePaidPlatformLimit(this.config.get<string>("MESSAGING_PAID_PLATFORM_DAILY_KOBO"));
    if (!this.isConfigured || release === "off" || !configuredLimit) {
      return { configured: this.isConfigured, release, financiallyAuthorized: false, ready: false };
    }
    const limit = await effectiveMessagingSpendLimit("platform", configuredLimit);
    const rates = await reviewedMessagingRates("platform", readVerifiedMessagingRates(this.config.get<string>("MESSAGING_LEGACY_SMS_RATES")));
    const cost = quoteDispatchCost(rates, "TERMII_SMS", "SCHOOLKIT", 1, new Date());
    const schoolLimit = schoolId ? this.legacyAuthorization(schoolId, eventType) : undefined;
    const scopeReady = schoolId && schoolLimit && cost ? await withTenant(schoolId, async (db) => {
      const school = await db.school.findFirst({
        where: { id: schoolId, status: "ACTIVE", suspendedAt: null, deletionStartedAt: null }, select: { id: true },
      });
      return !!school && await this.legacySpentToday(db, schoolId) + cost.walletKobo <=
        await effectiveMessagingSpendLimit(schoolId, schoolLimit, db);
    }) : false;
    const financiallyAuthorized = !!cost && cost.walletKobo <= limit && scopeReady;
    const [day] = await basePrisma.$queryRaw<{ reserved_kobo: bigint }[]>`
      SELECT reserved_kobo FROM messaging_platform_reservations_daily
      WHERE day = (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date`;
    const ready = financiallyAuthorized && (day?.reserved_kobo ?? 0n) + cost!.walletKobo <= limit &&
      !(await messagingEmergencyState("SMS")).stopped && (await messagingProviderActivation("SMS")).enabled !== false;
    return { configured: true, release, financiallyAuthorized, ready };
  }

  private async legacySpentToday(db: PrismaClient, schoolId: string): Promise<bigint> {
    const [usage] = await db.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM((metadata->>'reservedKobo')::bigint), 0)::bigint AS total FROM audit_logs
      WHERE school_id = ${schoolId} AND action = 'messaging.legacy-sms.spend-authorized'
        AND created_at >= (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'UTC'`;
    return usage?.total ?? 0n;
  }

  private async reservePlatformSpend(message: string, attribution?: LegacySmsAttribution): Promise<boolean> {
    const release = this.config.get<string>("MESSAGING_LEGACY_SMS_ENABLED") === "on" ||
      this.config.get<string>("MESSAGING_LEGACY_SMS_MIGRATION_MODE") === "existing-authorized";
    if (!release || !attribution) return false;
    const { schoolId, eventType, eventId } = attribution;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(eventId)) return false;
    const schoolCap = this.legacyAuthorization(schoolId, eventType);
    if (!schoolCap) return false;
    const configuredLimit = parsePaidPlatformLimit(this.config.get<string>("MESSAGING_PAID_PLATFORM_DAILY_KOBO"));
    if (!configuredLimit || (await messagingEmergencyState("SMS")).stopped ||
        (await messagingProviderActivation("SMS")).enabled === false) return false;
    const units = countSmsSegments(message);
    if (!units) return false;
    return withTenant(schoolId, async (db) => {
      const [school] = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM schools WHERE id = ${schoolId} AND status = 'ACTIVE'
          AND suspended_at IS NULL AND deletion_started_at IS NULL FOR UPDATE`;
      if (!school) return false;
      const limit = await effectiveMessagingSpendLimit("platform", configuredLimit, db);
      const rates = await reviewedMessagingRates("platform",
        readVerifiedMessagingRates(this.config.get<string>("MESSAGING_LEGACY_SMS_RATES")), db);
      const cost = quoteDispatchCost(rates, "TERMII_SMS", "SCHOOLKIT", units, new Date());
      if (!cost || cost.walletKobo > limit) return false;
      const schoolLimit = await effectiveMessagingSpendLimit(schoolId, schoolCap, db);
      if (await this.legacySpentToday(db, schoolId) + cost.walletKobo > schoolLimit) return false;
      if (eventType === "REMINDER_CAMPAIGN" && (attribution.approvedUnitKobo == null ||
          cost.walletKobo > BigInt(attribution.approvedUnitKobo) * BigInt(units))) return false;
      const { walletKobo } = cost;
      const reserved = await db.$executeRaw`
        INSERT INTO messaging_platform_reservations_daily (day, reserved_kobo)
        VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date, ${walletKobo}::bigint)
        ON CONFLICT (day) DO UPDATE SET reserved_kobo =
          messaging_platform_reservations_daily.reserved_kobo + EXCLUDED.reserved_kobo
        WHERE messaging_platform_reservations_daily.reserved_kobo + EXCLUDED.reserved_kobo <= ${limit}::bigint`;
      if (!reserved) return false;
      await db.auditLog.create({ data: {
        schoolId, action: "messaging.legacy-sms.spend-authorized", entityType: eventType, entityId: eventId,
        metadata: { segments: units, reservedKobo: String(walletKobo), rateVersion: cost.rateVersion },
      } });
      return true;
    });
  }

  private async requestSms(to: string, message: string, senderId?: string): Promise<SmsOutcome> {
    if ((await messagingEmergencyState("SMS")).stopped) return { status: "REJECTED", reason: "SMS_EMERGENCY_STOP" };
    if ((await messagingProviderActivation("SMS")).enabled === false) return { status: "REJECTED", reason: "SMS_PROVIDER_DISABLED" };
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
