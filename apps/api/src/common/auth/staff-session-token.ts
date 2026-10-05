import type { Request } from "express";

// Where a staff request's session token comes from (docs/deferred.md item 1,
// 2026-10-05).
//
// Two carriers, one session:
//
//   1. `Authorization: Bearer <token>` — the mobile app, the platform-admin
//      and invitation proxies, scripts and tests. Unchanged, and it wins when
//      present: a malformed header is still a 401, never a silent fall-through
//      to the cookie.
//   2. The `sk_session` HttpOnly cookie — the staff web app. The browser sends
//      it to the API's own schoolkit.ng address, so the token never has to
//      pass through page JavaScript, where any injected script could read it.
//
// The cookie is honoured ONLY when the request's Origin is the web app's
// (CORS_ORIGIN). That one rule is the CSRF defence:
//   - a third-party site cannot make the browser send the cookie at all
//     (SameSite=Lax), and
//   - a sibling schoolkit.ng app (portal, exam app, marketing site) counts as
//     "same-site", so the browser WOULD send it from there; the Origin check
//     is what refuses it. Browsers always send Origin on a cross-origin fetch,
//     and web → API is cross-origin, so the real web app always passes.
// A request with no Origin (curl, a server) gets no cookie auth: it has a
// bearer token to use instead.
export const STAFF_SESSION_COOKIE = "sk_session";

const BEARER_PREFIX = "Bearer ";

export type StaffTokenResult =
  | { kind: "token"; token: string; via: "bearer" | "cookie" }
  | { kind: "missing" };

/** The cookie's value from a raw Cookie header, or null. No cookie-parser dependency. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export function staffSessionToken(
  req: Pick<Request, "header">,
  webOrigin: string | undefined = process.env.CORS_ORIGIN ?? "http://localhost:3001",
): StaffTokenResult {
  const header = req.header("authorization");
  if (header !== undefined) {
    if (!header.startsWith(BEARER_PREFIX)) return { kind: "missing" };
    const token = header.slice(BEARER_PREFIX.length).trim();
    return token ? { kind: "token", token, via: "bearer" } : { kind: "missing" };
  }

  const origin = req.header("origin");
  if (!webOrigin || !origin || origin !== webOrigin) return { kind: "missing" };
  const token = readCookie(req.header("cookie"), STAFF_SESSION_COOKIE);
  return token ? { kind: "token", token, via: "cookie" } : { kind: "missing" };
}
