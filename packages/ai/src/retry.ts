// Phase 7 / CP2 — retry and backoff for embedding-vendor calls (D4a).
//
// This exists because of a real, measured operational fact rather than a
// defensive instinct. On 2026-09-02 an unpaid Voyage account was observed
// limited to 3 requests/minute; the fourth call in the live eval returned 429.
// A payment method has since lifted that (measured the same day: 500 requests
// in 11.6s with zero 429s, ~2577 req/min sustained), but the CONCLUSION D4a
// drew still stands and is the reason this module exists:
//
//   A 429 during ingestion must be a RETRY, never a FAILED document.
//
// A document marked FAILED because the vendor was briefly busy is a support
// conversation with a school, and the teacher's only recourse is to upload the
// same file again — which is exactly what a backoff would have done for them,
// without the confusion.
//
// SECOND, LESS OBVIOUS CASE, found while probing the lifted limit: at ~2500
// req/min the local machine ran out of sockets and 208 of 500 calls failed
// with a bare `fetch failed` — a CLIENT-side transient, not a vendor refusal.
// In a long ingestion run that class of error is more likely than a 429, so
// classification here covers transient network faults too. Treating only 429
// as retryable would have left the more probable failure mode unhandled.

export type VendorErrorKind =
  /** Vendor said slow down. Always retryable, and the one D4a is about. */
  | "rate-limit"
  /** Network/socket/5xx — retryable, and in practice more common than 429. */
  | "transient"
  /** 4xx that will never succeed on retry (bad key, malformed request). */
  | "fatal";

/**
 * Thrown by the Voyage port so callers can classify a failure without parsing
 * a message string. `status` is the HTTP status where there was one; a
 * client-side network fault has none.
 */
export class VendorApiError extends Error {
  readonly status: number | null;
  /** Parsed from a Retry-After header when the vendor sent one. */
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number | null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "VendorApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Classify a thrown error into retry policy.
 *
 * Falls back to message matching for errors that are not VendorApiError,
 * because `fetch` itself throws a plain TypeError("fetch failed") on a
 * socket-level fault and that is the case observed most often under load.
 */
export function classifyVendorError(err: unknown): VendorErrorKind {
  if (err instanceof VendorApiError) {
    if (err.status === 429) return "rate-limit";
    if (err.status === null) return "transient";
    if (err.status >= 500) return "transient";
    // 408 Request Timeout is a 4xx that genuinely is worth retrying.
    if (err.status === 408) return "transient";
    return "fatal";
  }

  const message = err instanceof Error ? err.message : String(err);
  // Node's undici surfaces socket exhaustion, DNS failures and resets as a
  // bare "fetch failed", sometimes with a cause. Observed 208 times in one
  // burst on 2026-09-02 — see the header.
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(message)) {
    return "transient";
  }
  if (/\b429\b|rate limit/i.test(message)) return "rate-limit";
  return "fatal";
}

export interface BackoffOptions {
  /** Total attempts including the first. 1 disables retrying. */
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /**
   * Injectable so specs run instantly instead of actually waiting. Production
   * passes nothing and gets a real timer.
   */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable for determinism in specs; defaults to Math.random. */
  readonly random?: () => number;
  /** Called before each wait — the ingestion worker logs through this. */
  readonly onRetry?: (info: {
    attempt: number;
    delayMs: number;
    kind: VendorErrorKind;
    error: unknown;
  }) => void;
}

export const BACKOFF_DEFAULTS = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  // Capped rather than unbounded: a BullMQ job holding a worker for minutes is
  // still cheaper than a failed document, but not indefinitely.
  maxDelayMs: 60_000,
} as const;

/**
 * Exponential backoff with FULL JITTER, and a Retry-After override.
 *
 * Full jitter (a uniform draw from [0, capped]) rather than a fixed doubling:
 * ingestion embeds many batches, and if several are retried in lockstep they
 * would re-collide at exactly the same moment on every subsequent attempt.
 * Jitter is what turns a synchronised retry storm back into a queue.
 *
 * When the vendor supplied Retry-After, that wins outright — it is the one
 * authoritative statement about when the limit clears, and guessing shorter
 * just burns an attempt.
 */
export function computeBackoffMs(
  attempt: number,
  options: BackoffOptions = {},
  retryAfterMs: number | null = null,
): number {
  const base = options.baseDelayMs ?? BACKOFF_DEFAULTS.baseDelayMs;
  const max = options.maxDelayMs ?? BACKOFF_DEFAULTS.maxDelayMs;
  const random = options.random ?? Math.random;

  if (retryAfterMs !== null && retryAfterMs >= 0) return Math.min(retryAfterMs, max);

  const exponential = Math.min(base * 2 ** Math.max(0, attempt - 1), max);
  return Math.floor(random() * exponential);
}

/**
 * Run `fn`, retrying on rate-limit and transient failures.
 *
 * A `fatal` classification is rethrown IMMEDIATELY without consuming
 * attempts — retrying a bad API key five times just delays a clear error by a
 * minute and makes the logs harder to read.
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? BACKOFF_DEFAULTS.maxAttempts;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const kind = classifyVendorError(err);
      if (kind === "fatal" || attempt === maxAttempts) throw err;

      const retryAfter = err instanceof VendorApiError ? err.retryAfterMs : null;
      const delayMs = computeBackoffMs(attempt, options, retryAfter);
      options.onRetry?.({ attempt, delayMs, kind, error: err });
      await sleep(delayMs);
    }
  }
  // Unreachable: the loop either returns or throws. Present so the function is
  // total for the type checker.
  throw lastError;
}

/**
 * Parse a Retry-After header. The spec allows either delta-seconds or an
 * HTTP-date, and vendors use both.
 */
export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}
