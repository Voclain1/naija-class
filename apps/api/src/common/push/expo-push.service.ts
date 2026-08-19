import { Injectable, Logger } from "@nestjs/common";

// ---------------------------------------------------------------------------
// Expo Push wrapper — Phase 6 / Slice 5 (D38, D39). Mirrors TermiiService's
// structure: thin fetch wrapper, no retries, no credentials checked at boot.
//
// UNLIKE Termii and Paystack, this service needs NO API key. Expo's push
// endpoint is unauthenticated for tokens you already hold — possession of an
// ExponentPushToken IS the authorization. That is why there is no
// ConfigService here and no new entry in .env.example.
//
// The FCM V1 service-account key Android delivery requires lives in EAS, not
// in this repo — it is uploaded once with `eas credentials` and Expo's
// servers use it on our behalf. Nothing in apps/api ever holds it.
// ---------------------------------------------------------------------------

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getPushNotificationReceipts";

// Expo documents a maximum of 100 messages per send request.
export const EXPO_BATCH_SIZE = 100;

const REQUEST_TIMEOUT_MS = 15_000;

/** One notification, already stripped of PII by the caller (D36). */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  /** Opaque routing hint. NEVER carries names, grades or amounts (D36). */
  data?: Record<string, string>;
}

/**
 * The immediate per-message outcome. "ok" means Expo ACCEPTED it, NOT that a
 * device received it — that answer only arrives later, in a receipt (D39).
 * Conflating the two is the specific mistake that makes dead tokens
 * invisible.
 */
export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoPushReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/**
 * The one receipt error that means "this app is gone". Expo documents it as
 * the signal to stop sending to a token — it is what D37's fallback depends
 * on to know a parent is no longer reachable by push.
 */
export const DEVICE_NOT_REGISTERED = "DeviceNotRegistered";

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  /**
   * Send one batch. Returns one ticket per message, in the SAME ORDER as the
   * input — Expo guarantees positional correspondence, and the caller relies
   * on it to map a ticket back to the token it came from.
   *
   * Throws on transport failure. Per-message failures are NOT thrown: they
   * come back as error tickets, because a batch of 100 where one token is
   * malformed must still deliver the other 99.
   */
  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    if (messages.length === 0) return [];
    if (messages.length > EXPO_BATCH_SIZE) {
      // A caller passing 400 would get 100 delivered and 300 silently
      // dropped by Expo. Refusing is louder than truncating.
      throw new Error(
        `ExpoPushService.send received ${messages.length} messages; the maximum is ${EXPO_BATCH_SIZE}. Batch before calling.`,
      );
    }

    const res = await fetch(EXPO_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Expo push send failed with HTTP ${res.status}`);
    }

    const parsed = (await res.json()) as { data?: ExpoPushTicket[]; errors?: unknown };
    if (!parsed.data) {
      throw new Error("Expo push send returned no data array");
    }
    return parsed.data;
  }

  /**
   * Poll receipts for previously-issued ticket ids (D39).
   *
   * Returns a map keyed by ticket id. Expo omits ids whose receipt is not
   * ready yet, so an ABSENT id means "ask again later", never "delivered" —
   * treating absence as success is how a dead token would survive the prune.
   */
  async getReceipts(ticketIds: string[]): Promise<Record<string, ExpoPushReceipt>> {
    if (ticketIds.length === 0) return {};

    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ ids: ticketIds }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Expo receipt poll failed with HTTP ${res.status}`);
    }

    const parsed = (await res.json()) as { data?: Record<string, ExpoPushReceipt> };
    return parsed.data ?? {};
  }
}
