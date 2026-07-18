import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { InternalError } from "@school-kit/types";

import { redactPhone } from "../redact.js";

// ---------------------------------------------------------------------------
// Termii SMS wrapper — Phase 4 / Slice 6 (D3). Mirrors PaystackService's
// structure: platform-wide credentials via ConfigService, checked lazily
// per-call (not at boot), thin fetch wrapper, no retries.
//
// API details confirmed against developers.termii.com (2026-07-18), not
// assumed — see docs/modules/phase-4.md §8 D6 for the full research note.
// ---------------------------------------------------------------------------

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
  async sendSms(to: string, message: string): Promise<void> {
    if (!this.apiKey) {
      throw new InternalError("TERMII_API_KEY is not configured on this server");
    }

    const res = await fetch(`${this.baseUrl}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        to,
        from: this.senderId,
        sms: message,
        type: "plain",
        channel: "dnd",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      this.logger.error(`Termii SMS send failed: ${res.status} ${text}`);
      throw new InternalError(`Termii SMS send failed (HTTP ${res.status}).`);
    }

    const json = (await res.json()) as TermiiSendResponse;
    if (json.code !== "ok") {
      this.logger.error(`Termii SMS send rejected: ${json.message ?? "unknown"} (to=${redactPhone(to)})`);
      throw new InternalError(`Termii SMS send rejected: ${json.message ?? "unknown reason"}.`);
    }
  }
}
