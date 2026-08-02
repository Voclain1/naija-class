import type { NextResponse } from "next/server";

// Shared sk_platform_session HttpOnly cookie helpers — the platform
// super-admin surface's own cookie, deliberately separate from sk_session
// (session-cookie.ts). Mirrors that module's shape exactly; see its header
// for why every proxy route that mints/clears a session must go through a
// helper like this rather than hand-rolling cookie options.
export const PLATFORM_ADMIN_SESSION_COOKIE_NAME = "sk_platform_session";
const PLATFORM_ADMIN_SESSION_COOKIE_MAX_AGE = 2_592_000; // 30 days — matches sk_session

export function setPlatformAdminSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(PLATFORM_ADMIN_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PLATFORM_ADMIN_SESSION_COOKIE_MAX_AGE,
  });
}

export function clearPlatformAdminSessionCookie(res: NextResponse): void {
  res.cookies.delete(PLATFORM_ADMIN_SESSION_COOKIE_NAME);
}
