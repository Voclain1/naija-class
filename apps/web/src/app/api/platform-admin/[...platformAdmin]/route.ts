// Next.js Route Handler: proxies platform-admin endpoints to NestJS and
// manages the sk_platform_session HttpOnly cookie. Mirrors
// apps/web/src/app/api/auth/[...auth]/route.ts exactly in shape, for the
// separate platform-admin cookie — see that file's header for the fuller
// rationale.
//   POST .../login   — set cookie on success (mints a real session, same
//                       as staff login; see platform-admin.service.ts for
//                       why the platform-admin flag isn't checked here).
//   DELETE .../logout — LOCAL ONLY: clears the cookie. There is no
//                       corresponding NestJS endpoint (out of the approved
//                       minimal scope — login/schools/users only), so this
//                       does not invalidate the underlying session row;
//                       it only stops this browser from presenting it.
//   GET .../schools, GET .../users — proxied transparently with the cookie
//                       as bearer.

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  clearPlatformAdminSessionCookie,
  PLATFORM_ADMIN_SESSION_COOKIE_NAME,
  setPlatformAdminSessionCookie,
} from "@/lib/server/platform-admin-session-cookie";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

async function forward(
  method: string,
  subPath: string,
  search: string,
  sessionToken: string | undefined,
): Promise<NextResponse> {
  const resp = await fetch(`${API_BASE}/platform-admin/${subPath}${search}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: "no-store",
  });

  const text = await resp.text();
  const data: unknown = text ? JSON.parse(text) : null;
  const out = NextResponse.json(data, { status: resp.status });

  if (resp.ok && subPath === "login") {
    const maybeToken =
      data !== null &&
      typeof data === "object" &&
      "token" in (data as object) &&
      typeof (data as { token: unknown }).token === "string"
        ? (data as { token: string }).token
        : null;
    if (maybeToken) {
      setPlatformAdminSessionCookie(out, maybeToken);
    }
  }

  return out;
}

async function forwardLogin(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const resp = await fetch(`${API_BASE}/platform-admin/login`, {
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
      setPlatformAdminSessionCookie(out, maybeToken);
    }
  }

  return out;
}

type Context = { params: Promise<{ platformAdmin: string[] }> };

export async function GET(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { platformAdmin } = await ctx.params;
  const subPath = platformAdmin.join("/");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(PLATFORM_ADMIN_SESSION_COOKIE_NAME)?.value;
  const search = req.nextUrl.search;
  return forward("GET", subPath, search, sessionToken);
}

export async function POST(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { platformAdmin } = await ctx.params;
  const subPath = platformAdmin.join("/");
  if (subPath === "login") {
    return forwardLogin(req);
  }
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(PLATFORM_ADMIN_SESSION_COOKIE_NAME)?.value;
  return forward("POST", subPath, "", sessionToken);
}

export async function DELETE(_req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { platformAdmin } = await ctx.params;
  const subPath = platformAdmin.join("/");
  if (subPath === "logout") {
    const out = NextResponse.json(null, { status: 204 });
    clearPlatformAdminSessionCookie(out);
    return out;
  }
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Not found." } },
    { status: 404 },
  );
}
