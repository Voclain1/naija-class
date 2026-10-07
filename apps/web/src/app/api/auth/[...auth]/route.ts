// Next.js Route Handler: proxies auth endpoints to NestJS and manages the
// sk_session HttpOnly cookie.  Four POST routes set/clear the cookie:
//   POST  .../login          — set cookie when requiresTwoFactor: false
//   POST  .../signup-owner   — always set cookie (signup always issues session)
//   POST  .../logout         — clear cookie
//   POST  .../2fa/challenge  — set cookie (always issues session)
// GET .../session            — { authenticated } from the cookie's presence, and
//                               re-issue the cookie with today's attributes.
// All other GETs / DELETEs are proxied transparently with the cookie as bearer.
//
// The session token NEVER goes back to the browser in a body (2026-10-05,
// docs/deferred.md item 1). The HttpOnly cookie is its only carrier; the API
// reads it directly (apps/api/src/common/auth/staff-session-token.ts).

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  clearSessionCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  upgradeSessionCookie,
} from "@/lib/server/session-cookie";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

async function forward(
  method: string,
  subPath: string,
  body: string | undefined,
  sessionToken: string | undefined,
): Promise<NextResponse> {
  const resp = await fetch(`${API_BASE}/auth/${subPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    ...(body !== undefined ? { body } : {}),
  });

  if (resp.status === 204) {
    const out = new NextResponse(null, { status: 204 });
    if (subPath === "logout") clearSessionCookie(out);
    return out;
  }

  const text = await resp.text();
  const data: unknown = text ? JSON.parse(text) : null;

  // Any successful response carrying a `token` string → set the session cookie.
  // Covers login (requiresTwoFactor: false), signup-owner, and 2fa/challenge.
  // The login 2FA-challenge branch returns { requiresTwoFactor: true, challengeToken }
  // which has no `token` field, so the cookie is NOT set for that branch.
  const maybeToken =
    resp.ok &&
    data !== null &&
    typeof data === "object" &&
    "token" in (data as object) &&
    typeof (data as { token: unknown }).token === "string"
      ? (data as { token: string }).token
      : null;

  // Strip it from the body: the cookie set below is its only carrier.
  const bodyForClient = maybeToken
    ? Object.fromEntries(Object.entries(data as object).filter(([key]) => key !== "token"))
    : data;
  const out = NextResponse.json(bodyForClient, { status: resp.status });

  if (maybeToken) setSessionCookie(out, maybeToken);
  if (resp.ok && subPath === "logout") clearSessionCookie(out);

  return out;
}

type Context = { params: Promise<{ auth: string[] }> };

export async function GET(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { auth } = await ctx.params;
  const subPath = auth.join("/");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  // Special non-proxy route: whether a session cookie exists, so cold boot can
  // skip a doomed /auth/me for a visitor who never signed in. It says nothing
  // about validity (the API decides that) and never returns the token.
  // It also re-issues the cookie with today's attributes, which moves a
  // pre-switch-over host-only cookie onto the shared domain the API reads.
  if (subPath === "session") {
    const out = NextResponse.json({ authenticated: Boolean(sessionToken) });
    if (sessionToken) upgradeSessionCookie(out, sessionToken);
    return out;
  }

  return forward("GET", subPath, undefined, sessionToken);
}

export async function POST(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { auth } = await ctx.params;
  const subPath = auth.join("/");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const body = await req.text();
  return forward("POST", subPath, body, sessionToken);
}

export async function DELETE(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { auth } = await ctx.params;
  const subPath = auth.join("/");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const body = await req.text();
  return forward("DELETE", subPath, body || undefined, sessionToken);
}
