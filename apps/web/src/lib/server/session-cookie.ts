import type { NextResponse } from "next/server";

// Shared sk_session HttpOnly cookie helpers. Every Next.js route handler
// that proxies a session-issuing NestJS endpoint (login, signup, 2fa
// challenge, invitation accept, ...) must go through here rather than
// hand-rolling its own cookie options — a proxy route that skips this and
// calls NestJS directly never sets the cookie, and any subsequent hard
// navigation to a protected route will bounce off middleware.ts's cookie
// check straight back to /login (see the invitation-accept fix this module
// was extracted for).
export const SESSION_COOKIE_NAME = "sk_session";
const SESSION_COOKIE_MAX_AGE = 2_592_000; // 30 days

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.delete(SESSION_COOKIE_NAME);
}
