import * as Sentry from "@sentry/nextjs";

import { ApiError } from "@/lib/api-client";

/**
 * A dashboard load is read-only. Never display an exception's text here:
 * it can contain a backend code or request detail that does not help an owner
 * recover. The next useful action is simply to retry the read.
 *
 * That reasoning is about DISPLAY, and it stayed correct. What was wrong was
 * that this function also DISCARDED the error — the parameter was named
 * `_error` and never read — so a 500, a 403, a dropped connection and a JSON
 * parse failure were indistinguishable on screen AND in telemetry. A caught
 * promise rejection is never auto-captured by Sentry, so nothing anywhere
 * recorded which of them had happened.
 *
 * That is why the 2026-09-11 deadlock investigation had to reason from API-side
 * Sentry event counts to infer what the browser had seen. Capture first, then
 * return the same safe copy.
 */
export function dashboardErrorMessage(error: unknown): string {
  captureDashboardLoadFailure(error);
  return "We couldn’t load your dashboard. Refresh and try again.";
}

/**
 * Records what was actually caught. Deliberately a separate function from the
 * copy above, so the capture cannot be quietly dropped by someone simplifying
 * a one-line return.
 *
 * `failureKind` is the field worth having: it separates a server fault from a
 * transport fault — the distinction the copy intentionally hides from the
 * owner, and the one an engineer needs first.
 */
function captureDashboardLoadFailure(error: unknown): void {
  let failureKind: string;
  let apiCode: string | undefined;
  let status: number | undefined;

  if (error instanceof ApiError) {
    // The API answered. Its own envelope says what went wrong.
    failureKind = error.status >= 500 ? "api-5xx" : "api-4xx";
    apiCode = error.code;
    status = error.status;
  } else if (error instanceof TypeError) {
    // fetch() rejects with TypeError for a genuine transport failure —
    // offline, DNS, CORS, connection reset. No response was received at all,
    // which is a different problem from any status code.
    failureKind = "network";
  } else {
    // A non-Error throw, or JSON.parse failing on a malformed body.
    failureKind = "unknown";
  }

  Sentry.captureException(error, {
    tags: {
      surface: "admin-dashboard",
      failureKind,
      ...(apiCode ? { apiCode } : {}),
    },
    ...(status === undefined ? {} : { extra: { status } }),
  });
}
