import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

// Throwaway verification route for phase-4.md §7 Decision D5 — proves the
// portal's session cookie can be scoped to the exact `portal.schoolkit.ng`
// host (never a wildcard `.schoolkit.ng`) before slice 2 builds real auth on
// top of the same mechanism. Delete this route once GuardianSession-backed
// login lands.
//
// Hit twice: the first request has no cookie yet, so it sets one and says
// so; the second request reads the value back. The manual gate (phase-4.md
// §7 CP2) additionally checks the cookie is NOT visible from apps/web's
// origin — that negative check is what actually proves isolation, not just
// that a cookie got set.
//
// Domain attribute: only set explicitly when the request's own Host header
// is the real production domain. On localhost or a Vercel preview URL,
// omitting `domain` lets the browser default to the exact current host —
// setting `Domain=portal.schoolkit.ng` from a *different* host is not just
// unhelpful, the browser rejects it outright (a cookie's Domain must be the
// current host or a parent of it).
const COOKIE_NAME = "sk_portal_probe";
const PRODUCTION_HOST = "portal.schoolkit.ng";

export async function GET() {
  const headerList = await headers();
  const host = headerList.get("host") ?? "";
  const cookieStore = await cookies();
  const existing = cookieStore.get(COOKIE_NAME);

  if (existing) {
    return NextResponse.json({ read: true, value: existing.value, host });
  }

  const value = `probe-${Date.now()}`;
  const response = NextResponse.json({ set: true, value, host });
  response.cookies.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    ...(host === PRODUCTION_HOST ? { domain: PRODUCTION_HOST } : {}),
  });
  return response;
}
