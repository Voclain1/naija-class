// Next.js Route Handler: proxies POST /invitations/:token/accept to NestJS
// and sets the sk_session HttpOnly cookie on success — mirrors
// /api/auth/[...auth]/route.ts's cookie-setting pattern (shared via
// lib/server/session-cookie.ts).
//
// AcceptInvitationResponse mints a real session (same shape as login/signup:
// { user, school, token }), but the endpoint itself lives under NestJS's
// /invitations/*, not /auth/*, so it was never covered by the auth proxy.
// Before this route existed, apps/web/src/lib/invitations/invitations-api.ts
// called NestJS directly via apiFetch, which never sets a cookie on the web
// origin — the subsequent hard navigation to /dashboard then had no cookie
// and no surviving in-memory token (a full page reload wipes it), so
// middleware.ts's cookie check deterministically bounced every accept back
// to /login. See docs/deferred.md's e2e-hang root-cause entry for the full
// trail (traced via two independent CI logs + local reproduction).
//
// No bearer/cookie forwarding needed on the request side — accepting an
// invitation is a public, unauthenticated action; the token param IS the
// credential.
import { NextRequest, NextResponse } from "next/server";

import { setSessionCookie } from "@/lib/server/session-cookie";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type Context = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { token } = await ctx.params;
  const body = await req.text();

  const resp = await fetch(`${API_BASE}/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const text = await resp.text();
  const data: unknown = text ? JSON.parse(text) : null;
  const out = NextResponse.json(data, { status: resp.status });

  if (resp.ok) {
    const maybeToken =
      data !== null &&
      typeof data === "object" &&
      "token" in (data as object) &&
      typeof (data as { token: unknown }).token === "string"
        ? (data as { token: string }).token
        : null;
    if (maybeToken) {
      setSessionCookie(out, maybeToken);
    }
  }

  return out;
}
