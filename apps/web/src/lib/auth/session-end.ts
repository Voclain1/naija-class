// Why a session ended, and where to send the user afterwards.
//
// F-10: every way a staff/teacher session could end took the user to a bare
// `/login` — no explanation, and no memory of where they had been. Three
// separate call sites did it (`middleware.ts`, `RequireAuth`, and the
// mid-session 401 handler in `auth-provider.tsx`), all with the same
// `router.replace("/login")`, so a user whose session expired mid-task and a
// user who deliberately signed out saw an identical screen.
//
// THE SERVER ALREADY KNOWS WHY. `AuthGuard` distinguishes four cases and has
// since Phase 0 — SESSION_EXPIRED, INVALID_SESSION (revoked/unknown token),
// USER_INACTIVE (account deactivated), MISSING_BEARER_TOKEN. Every one of
// them arrives in the `{ error: { code } }` envelope. The client simply threw
// the code away: `apiFetch` dispatched a bare CustomEvent with no detail.
//
// So nothing here invents semantics. It surfaces a distinction the API has
// been making all along, which is why "expired" and "revoked" can be told
// apart honestly rather than both being called a timeout.
//
// Pure and framework-free so it can be unit-tested under apps/web's
// node-environment Vitest runner (see apps/web/vitest.config.ts — no DOM
// tests by standing decision).

/** Reasons a session ended, in the vocabulary the UI speaks. */
export type SessionEndReason =
  /** The token was valid but its lifetime ran out. */
  | "expired"
  /** The session row is gone — signed out elsewhere, or an admin revoked it. */
  | "revoked"
  /** The account itself was deactivated. */
  | "deactivated"
  /** The user pressed Sign out. Deliberately NOT an alarming state. */
  | "signed-out";

/** The query parameter carrying the reason to /login. */
export const SESSION_END_PARAM = "reason";
/** The query parameter carrying the intended destination to /login. */
export const NEXT_PARAM = "next";

/**
 * Map an API error code to a reason.
 *
 * MISSING_BEARER_TOKEN maps to "revoked" rather than a fifth reason: from the
 * user's side there is no difference between "the server has no record of
 * your session" and "you never sent one" — both mean *you are not signed in
 * any more*, and inventing a distinct message would be describing our own
 * plumbing rather than their situation.
 *
 * An unrecognised code returns null: better to show the neutral sign-in
 * screen than to assert a reason we cannot stand behind.
 */
export function reasonFromErrorCode(code: string | undefined): SessionEndReason | null {
  switch (code) {
    case "SESSION_EXPIRED":
      return "expired";
    case "INVALID_SESSION":
    case "MISSING_BEARER_TOKEN":
      return "revoked";
    case "USER_INACTIVE":
      return "deactivated";
    default:
      return null;
  }
}

/** Narrow an untrusted query-string value back to a reason. */
export function parseSessionEndReason(raw: string | null): SessionEndReason | null {
  switch (raw) {
    case "expired":
    case "revoked":
    case "deactivated":
    case "signed-out":
      return raw;
    default:
      return null;
  }
}

export interface SessionEndNotice {
  title: string;
  body: string;
  tone: "info" | "warning";
}

/**
 * User-facing copy. No error codes, no "401", no "token" — a teacher who
 * has just lost half a gradebook does not need our vocabulary.
 *
 * `signed-out` returns null deliberately: pressing Sign out and then being
 * told something happened to your session is alarming for no reason. A
 * deliberate sign-out gets the ordinary login screen.
 */
export function sessionEndNotice(reason: SessionEndReason | null): SessionEndNotice | null {
  switch (reason) {
    case "expired":
      return {
        title: "Your session expired",
        body: "Sign in again to continue where you left off.",
        tone: "info",
      };
    case "revoked":
      return {
        title: "You were signed out",
        body: "Your session was ended on this or another device. Sign in again to continue.",
        tone: "info",
      };
    case "deactivated":
      return {
        // The one case that is NOT solved by signing in again, so it must not
        // suggest that it is.
        title: "Your account is no longer active",
        body: "Contact your school administrator if you think this is a mistake.",
        tone: "warning",
      };
    case "signed-out":
    case null:
      return null;
  }
}

/**
 * Is this a safe place to send someone after they sign in?
 *
 * The value arrives from a query string, so it is attacker-controlled: an
 * open redirect here would let a phishing link bounce a freshly-authenticated
 * administrator onto a look-alike site at the exact moment they trust the
 * app most. Everything except a plain, same-origin, absolute path is refused.
 *
 * Rejected, and why each matters:
 *   - "https://evil.example"      absolute URL, different origin
 *   - "//evil.example"            protocol-relative — the browser reads the
 *                                 leading "//" as a host, not a path
 *   - "/\\evil.example"           backslash variant; some parsers normalise
 *                                 "\" to "/", making this protocol-relative
 *   - "javascript:..."            not a path at all
 *   - "%2f%2fevil.example"        percent-encoded "//" — decoded before the
 *                                 check precisely so an encoded form cannot
 *                                 slip past a raw-string test
 *   - "/login"                    same-origin but a redirect loop
 *   - anything not starting "/"   relative paths resolve against whatever
 *                                 page is current, which is not a promise we
 *                                 can keep
 */
export function isSafeNextPath(raw: string | null | undefined): raw is string {
  if (!raw) return false;

  // Decode first, so an encoded "//" or "\" is judged on what the browser
  // would actually end up navigating to. Malformed encoding is refused
  // outright rather than guessed at.
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return false;
  }

  // Control characters (including a bare newline, tab or NUL) can split
  // headers or confuse a URL parser; a legitimate in-app path never contains
  // one. Written as an explicit range so the intent survives copy/paste.
  if ([...value].some((ch) => ch.codePointAt(0)! < 0x20 || ch.codePointAt(0)! === 0x7f)) {
    return false;
  }

  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  if (value.startsWith("/login")) return false;

  return true;
}

/** The safe destination, or the caller's default when it is not usable. */
export function resolveNextPath(raw: string | null | undefined, fallback: string): string {
  return isSafeNextPath(raw) ? raw : fallback;
}

/**
 * Build the /login URL for a session that has ended.
 *
 * `next` is omitted entirely for an unsafe or absent path, and for a
 * deliberate sign-out — returning to where you were is a courtesy for an
 * interruption, not for a decision to leave.
 */
export function buildLoginUrl(input: {
  reason: SessionEndReason | null;
  next?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.reason && input.reason !== "signed-out") {
    params.set(SESSION_END_PARAM, input.reason);
  }
  if (input.reason !== "signed-out" && isSafeNextPath(input.next)) {
    params.set(NEXT_PARAM, input.next);
  }
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}
