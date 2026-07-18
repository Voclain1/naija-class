// Next.js Route Handler: proxies /portal/* to the NestJS API and manages the
// sk_portal_session HttpOnly cookie. Mirrors apps/web's
// src/app/api/auth/[...auth]/route.ts pattern closely (same catch-all +
// cookie-on-token-response shape), with two deliberate differences that
// follow directly from D5 (docs/modules/phase-4.md §7, locked 2026-07-12):
//
//   1. Cookie name is sk_portal_session, never sk_session — a session
//      issued by one app must be structurally distinct from the other's,
//      not just differently scoped (see ARCHITECTURE.md §12).
//   2. Domain is set EXPLICITLY to portal.schoolkit.ng, and ONLY when the
//      request's own Host header actually is that production host — same
//      conditional logic proven by slice 1's dev-cookie-check route
//      (deleted once this lands for real, per that route's own header
//      comment). On localhost or a Vercel preview URL, omitting `domain`
//      lets the browser default to the exact current host; setting
//      Domain=portal.schoolkit.ng from a different host would be silently
//      rejected by the browser, not just unhelpful.
//
// POST  .../login               — set cookie (login has no 2FA branch here)
// GET   .../invitations/:token  — proxied transparently, no cookie involved
// POST  .../invitations/:token/accept — set cookie (accept = auto-login)

import { cookies, headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const COOKIE_NAME = "sk_portal_session";
const COOKIE_MAX_AGE = 2_592_000; // 30 days — matches GUARDIAN_SESSION_TTL_MS server-side
const PRODUCTION_HOST = "portal.schoolkit.ng";

// Bug found 2026-07-17 during the guardian-invite manual test: a
// misconfigured NEXT_PUBLIC_API_URL made this route's fetch() fail with
// ECONNREFUSED, which was uncaught here, so Next.js returned its own
// generic (non-JSON) 500 page. The frontend's error handling then fell back
// to a generic "invitation not valid" message — actively misleading, since
// the real problem was this route never reaching the API at all, not a bad
// token. Catching it here and returning the same { error: { code, message
// } } envelope the rest of the app uses means the frontend's existing
// error-message parsing (which already reads body.error.message) surfaces
// the true cause instead of guessing.
async function forward(
  method: string,
  subPath: string,
  body: string | undefined,
  sessionToken: string | undefined,
  host: string,
): Promise<NextResponse> {
  let resp: Response;
  let text: string;
  try {
    resp = await fetch(`${API_BASE}/portal/${subPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      ...(body !== undefined ? { body } : {}),
    });
    text = await resp.text();
  } catch (err) {
    console.error("[portal proxy] upstream fetch failed", err);
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_UNREACHABLE",
          message: "Could not reach the server. Try again in a moment.",
        },
      },
      { status: 502 },
    );
  }

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    console.error("[portal proxy] upstream returned a non-JSON response", err);
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_UNREACHABLE",
          message: "Could not reach the server. Try again in a moment.",
        },
      },
      { status: 502 },
    );
  }

  // login and invitations/:token/accept both return { token: string, ... }
  // on success. GET invitations/:token never has a token field, so the
  // cookie logic below is correctly a no-op for that path.
  const maybeToken =
    resp.ok &&
    data !== null &&
    typeof data === "object" &&
    "token" in (data as object) &&
    typeof (data as { token: unknown }).token === "string"
      ? (data as { token: string }).token
      : null;

  // Strip the raw token from the body the browser receives — unlike
  // apps/web's equivalent route, the portal never stores a token in client
  // JS at all (no in-memory activeToken, no /api/portal/session hydration
  // endpoint). The httpOnly cookie set below is the ONLY place the token
  // lives client-side; leaving it in the JSON body too would give an XSS
  // a second way to steal it, defeating half the point of httpOnly.
  const bodyForClient = maybeToken
    ? Object.fromEntries(Object.entries(data as object).filter(([key]) => key !== "token"))
    : data;

  const out = NextResponse.json(bodyForClient, { status: resp.status });

  if (maybeToken) {
    out.cookies.set(COOKIE_NAME, maybeToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      ...(host === PRODUCTION_HOST ? { domain: PRODUCTION_HOST } : {}),
    });
  }

  return out;
}

type Context = { params: Promise<{ portal: string[] }> };

export async function GET(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { portal } = await ctx.params;
  const subPath = portal.join("/");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;
  const headerList = await headers();
  const host = headerList.get("host") ?? "";
  return forward("GET", subPath, undefined, sessionToken, host);
}

export async function POST(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { portal } = await ctx.params;
  const subPath = portal.join("/");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;
  const headerList = await headers();
  const host = headerList.get("host") ?? "";
  const body = await req.text();
  return forward("POST", subPath, body, sessionToken, host);
}
