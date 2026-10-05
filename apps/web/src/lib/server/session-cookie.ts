import type { NextResponse } from "next/server";

// Shared sk_session HttpOnly cookie helpers. Every Next.js route handler
// that proxies a session-issuing NestJS endpoint (login, signup, 2fa
// challenge, invitation accept, ...) must go through here rather than
// hand-rolling its own cookie options — a proxy route that skips this and
// calls NestJS directly never sets the cookie, and any subsequent hard
// navigation to a protected route will bounce off middleware.ts's cookie
// check straight back to /login (see the invitation-accept fix this module
// was extracted for).
//
// THE COOKIE IS THE ONLY CARRIER of a staff web session (2026-10-05,
// docs/deferred.md item 1). The browser sends it straight to the API, which
// accepts it from the web app's Origin only (apps/api/src/common/auth/
// staff-session-token.ts), so the token never passes through page
// JavaScript. For that the API must be able to receive it:
//
//   - production: the API lives at api.schoolkit.ng and the cookie carries
//     Domain=schoolkit.ng (SESSION_COOKIE_DOMAIN), so app. and api. both get it;
//   - development: no domain. A host-only cookie on `localhost` is sent to
//     localhost:4000 too, because cookies are not scoped by port.
export const SESSION_COOKIE_NAME = "sk_session";
const SESSION_COOKIE_MAX_AGE = 2_592_000; // 30 days

/** The Domain attribute, or undefined for a host-only cookie. Read per call: server env. */
export function sessionCookieDomain(): string | undefined {
  const raw = process.env.SESSION_COOKIE_DOMAIN?.trim().replace(/^\./, "");
  return raw ? raw : undefined;
}

function attributes() {
  const domain = sessionCookieDomain();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, { ...attributes(), maxAge: SESSION_COOKIE_MAX_AGE });
}

/**
 * Clears the cookie. Attributes must match the set exactly (domain above all)
 * or the browser keeps it. With a domain configured, a host-only copy left by
 * an earlier sign-in is cleared as well.
 */
export function clearSessionCookie(res: NextResponse): void {
  const domain = sessionCookieDomain();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  if (domain) {
    res.headers.append("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
    res.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=; Domain=${domain}; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
    );
    return;
  }
  res.cookies.set(SESSION_COOKIE_NAME, "", { ...attributes(), maxAge: 0 });
}

/**
 * Re-issues an existing session cookie with today's attributes. Sign-ins from
 * before the switch to api.schoolkit.ng hold a HOST-ONLY cookie on
 * app.schoolkit.ng, which the API never receives; without this, every signed-in
 * member of staff would be signed out by the deploy. The host-only copy is
 * deleted and the same token set again with the shared domain. A no-op when
 * no domain is configured (development), where host-only is already right.
 */
export function upgradeSessionCookie(res: NextResponse, token: string): void {
  const domain = sessionCookieDomain();
  if (!domain) return;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.headers.append("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Domain=${domain}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
  );
}
