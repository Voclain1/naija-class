// Human-facing copy for a failed finance request.
//
// Replaces `String(e)` (finance dashboard, debtors) and bare `console.error`
// with a rule a bursar can act on. `String(e)` renders "ApiError: ..." or
// "TypeError: Failed to fetch" — the error's CLASS NAME leaks into the UI,
// which is both meaningless to a school employee and, for a TypeError, an
// implementation detail of the browser's fetch stack.
//
// The raw error is NOT discarded: `logFinanceError` keeps it on the console
// (and, in production, inside the global-error/Sentry path via a rethrow at
// the boundary that owns it) so developers lose no diagnostics. Only the
// STRING SHOWN TO THE USER is sanitised.

import { ApiError } from "../api-client";

/** Fallbacks used when the API gave us nothing quotable. */
const NETWORK_COPY =
  "Could not reach the server. Check your internet connection and try again.";
const SERVER_COPY =
  "Something went wrong on our side. Please try again in a moment.";
const PERMISSION_COPY =
  "You do not have permission to do this. Ask an administrator for access.";
const NOT_FOUND_COPY = "That record no longer exists. Refresh and try again.";

/**
 * Turn any thrown value into a sentence a school bursar can read.
 *
 * ApiError messages come from the NestJS error envelope and are already
 * written for humans (e.g. "Cannot cancel an invoice that has recorded
 * payments.") — those are passed through, because they say the one thing the
 * user most needs to know. Everything else is mapped by status, and non-API
 * throwables (TypeError from fetch, anything unexpected) never have their
 * text shown.
 */
export function financeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return PERMISSION_COPY;
    if (error.status === 404) return NOT_FOUND_COPY;
    if (error.status >= 500) return SERVER_COPY;
    // 4xx from our own API: the envelope's message is deliberate, reviewed
    // copy. Guard against an empty/placeholder one before trusting it.
    const message = error.message?.trim();
    if (message && message !== error.code) return message;
    return SERVER_COPY;
  }
  // Anything that isn't an ApiError never reached (or never returned from)
  // the API — in practice a fetch-level network failure.
  return NETWORK_COPY;
}

/**
 * Console (and, in production builds, Sentry-visible) record of the real
 * error. Called alongside financeErrorMessage so the sanitised UI string
 * never costs us the diagnostic.
 */
export function logFinanceError(context: string, error: unknown): void {
  console.error(`[finance] ${context}:`, error);
}
