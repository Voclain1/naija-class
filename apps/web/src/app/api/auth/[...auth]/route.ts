// Next.js Route Handler: proxies auth endpoints to NestJS and manages the
// sk_session HttpOnly cookie.  Four POST routes set/clear the cookie:
//   POST  .../login          — set cookie when requiresTwoFactor: false
//   POST  .../signup-owner   — always set cookie (signup always issues session)
//   POST  .../logout         — clear cookie
//   POST  .../2fa/challenge  — set cookie (always issues session)
// GET .../session            — read cookie, return { token } for in-memory hydration.
// All other GETs / DELETEs are proxied transparently with the cookie as bearer.

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const COOKIE_NAME = "sk_session";
const COOKIE_MAX_AGE = 2_592_000; // 30 days

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
    if (subPath === "logout") out.cookies.delete(COOKIE_NAME);
    return out;
  }

  const text = await resp.text();
  const data: unknown = text ? JSON.parse(text) : null;
  const out = NextResponse.json(data, { status: resp.status });

  if (resp.ok) {
    // Any successful response carrying a `token` string → set the session cookie.
    // Covers login (requiresTwoFactor: false), signup-owner, and 2fa/challenge.
    // The login 2FA-challenge branch returns { requiresTwoFactor: true, challengeToken }
    // which has no `token` field, so the cookie is NOT set for that branch.
    const maybeToken =
      data !== null &&
      typeof data === "object" &&
      "token" in (data as object) &&
      typeof (data as { token: unknown }).token === "string"
        ? (data as { token: string }).token
        : null;
    if (maybeToken) {
      out.cookies.set(COOKIE_NAME, maybeToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: COOKIE_MAX_AGE,
      });
    }
    if (subPath === "logout") out.cookies.delete(COOKIE_NAME);
  }

  return out;
}

type Context = { params: Promise<{ auth: string[] }> };

export async function GET(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { auth } = await ctx.params;
  const subPath = auth.join("/");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

  // Special non-proxy route: return the token from the cookie so the client
  // can seed its in-memory activeToken on cold boot without ever touching
  // localStorage.
  if (subPath === "session") {
    return NextResponse.json({ token: sessionToken ?? null });
  }

  return forward("GET", subPath, undefined, sessionToken);
}

export async function POST(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { auth } = await ctx.params;
  const subPath = auth.join("/");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;
  const body = await req.text();
  return forward("POST", subPath, body, sessionToken);
}

export async function DELETE(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { auth } = await ctx.params;
  const subPath = auth.join("/");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;
  const body = await req.text();
  return forward("DELETE", subPath, body || undefined, sessionToken);
}
