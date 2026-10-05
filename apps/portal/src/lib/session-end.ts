// Why a guardian's portal session ended, and where to send them afterwards.
//
// The portal's half of F-10. Last slice gave `middleware.ts` a `next`
// parameter for the cold-load case (following a link while signed out), but
// the MID-SESSION path was untouched: both authenticated pages still did a
// bare `router.replace("/login")` on a 401, so a parent whose session
// expired while reading their child's fees lost the page they were on and
// was told nothing about why they were suddenly at a login screen.
//
// SEPARATE FROM apps/web's equivalent, deliberately. The two auth systems
// are genuinely different — different cookie, different guard, different
// principal, no shared client runtime (see ARCHITECTURE.md §12) — and the
// copy differs too: a parent is not a staff member and "contact your school
// administrator" means something different to each. Sharing this through a
// package would couple two systems the codebase has kept apart on purpose.
// What IS shared is the rule set below, and it is the stricter of the two
// that won: the portal's previous inline `safeNextPath` accepted several
// things this rejects.
//
// The server already distinguishes the reasons. GuardianAuthGuard emits
// SESSION_EXPIRED, INVALID_SESSION, MISSING_BEARER_TOKEN and (since
// 2026-10-02) USER_INACTIVE as distinct codes; nothing here is invented.

export type SessionEndReason = "expired" | "revoked" | "deactivated" | "suspended" | "signed-out";

/**
 * Map a guardian 401 code to a reason.
 *
 * "deactivated" exists since 2026-10-02, when schools gained a switch for a
 * parent's portal access and GuardianAuthGuard began returning USER_INACTIVE
 * — the same code a deactivated staff account gets. Before that the case was
 * deliberately absent: the server could not say it, so the client must not.
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
    // The whole school suspended by School Kit (2026-10-07).
    case "SCHOOL_SUSPENDED":
      return "suspended";
    default:
      return null;
  }
}

export function parseSessionEndReason(raw: string | null): SessionEndReason | null {
  switch (raw) {
    case "expired":
    case "revoked":
    case "deactivated":
    case "suspended":
    case "signed-out":
      return raw;
    default:
      return null;
  }
}

export interface SessionEndNotice {
  title: string;
  body: string;
}

/**
 * Copy for a parent, not for an engineer. No codes, no "token", no "401".
 *
 * `signed-out` returns null: a parent who pressed Sign out on a shared
 * school computer should not then be told something happened to their
 * session.
 */
export function sessionEndNotice(reason: SessionEndReason | null): SessionEndNotice | null {
  switch (reason) {
    case "expired":
      return {
        title: "Your session expired",
        body: "Sign in again to continue where you left off.",
      };
    case "revoked":
      return {
        title: "You were signed out",
        body: "Sign in again to see your children's information.",
      };
    // The one reason where "sign in again" would be wrong advice: it will not
    // work until the school turns access back on. Say who can fix it.
    case "deactivated":
      return {
        title: "Your portal access is switched off",
        body: "Your school has turned off portal access for this account. Contact the school if you think this is a mistake.",
      };
    // Also not fixed by signing in again. Fees can still be paid through the
    // payment link the school sends — that is not a portal sign-in.
    case "suspended":
      return {
        title: "The portal is unavailable for your school",
        body: "You can't sign in at the moment. You can still pay fees from a payment link the school sends you. Contact the school for more.",
      };
    case "signed-out":
    case null:
      return null;
  }
}

/**
 * Is this a safe destination after signing in?
 *
 * REPLACES the portal's previous inline check, which accepted several things
 * it should not have: it tested the raw string, so `%2f%2fevil.example`
 * passed; it did not consider the `/\` backslash form; and it would happily
 * bounce a user back to `/login`. All three are refused here, and each has a
 * named E2E case.
 */
export function isSafeNextPath(raw: string | null | undefined): raw is string {
  if (!raw) return false;

  let value: string;
  try {
    // Decode first, so the check judges what the browser would actually
    // navigate to rather than the literal parameter text.
    value = decodeURIComponent(raw);
  } catch {
    return false;
  }

  if ([...value].some((ch) => ch.codePointAt(0)! < 0x20 || ch.codePointAt(0)! === 0x7f)) {
    return false;
  }

  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  if (value.startsWith("/login")) return false;

  return true;
}

/** The safe destination, or the portal home. */
export function resolveNextPath(raw: string | null | undefined): string {
  return isSafeNextPath(raw) ? raw : "/";
}

/** Build the /login URL for a session that has ended. */
export function buildLoginUrl(input: {
  reason: SessionEndReason | null;
  next?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.reason && input.reason !== "signed-out") {
    params.set("reason", input.reason);
  }
  if (input.reason !== "signed-out" && isSafeNextPath(input.next)) {
    params.set("next", input.next);
  }
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

/**
 * Pull the error code out of a portal proxy response body.
 *
 * The proxy forwards the API's `{ error: { code, message } }` envelope
 * verbatim, so this is the same shape every portal page already parses for
 * its error message — it just reads a different field.
 */
export function errorCodeFromBody(body: unknown): string | undefined {
  if (body === null || typeof body !== "object" || !("error" in body)) return undefined;
  const err = (body as { error?: { code?: unknown } }).error;
  return typeof err?.code === "string" ? err.code : undefined;
}
