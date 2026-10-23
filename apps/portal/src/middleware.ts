import { NextResponse, type NextRequest } from "next/server";

import { PORTAL_URL, schoolCodeFromHost } from "./lib/school-host";

// Route protection for the guardian portal.
//
// WHY THIS DID NOT EXIST BEFORE, and why it does now. Until 2026-08-27 the
// portal had NO middleware at all: every protected page was a client
// component that fetched its data on mount and did router.replace("/login")
// on a 401. That is a real check — the API is the authority and it was
// always being asked — but it has two consequences that matter once there is
// a Sign out button to press:
//
//   1. The authenticated shell RENDERS FIRST and is replaced a moment later.
//      On a slow connection a signed-out visitor to /students/<id> sees the
//      page furniture before it disappears. Nothing sensitive is in it (the
//      data is what 401s), but it reads as though access was granted.
//   2. There was nowhere to make a decision BEFORE the document was served,
//      which is what "prevent Back from exposing authenticated data" needs.
//
// This mirrors apps/web/src/middleware.ts deliberately, including its own
// central caveat: the cookie's PRESENCE is all that is checked here, never
// its validity. A forged or expired sk_portal_session gets past middleware
// and is then rejected by the API on the page's own fetch — which is the
// real gate, and remains so. Middleware is a UX and defence-in-depth layer,
// not the authorization boundary. Treating it as the boundary would be a
// mistake: the token is opaque here (validating it means a DB round-trip
// through the SECURITY DEFINER resolver, which is exactly what the API does).
const COOKIE_NAME = "sk_portal_session";

// The signed-in surfaces. Since 2026-10-22 middleware runs on every page (a
// school's own address is routed below), so this list, not the matcher, now
// decides which paths need a session.
const PROTECTED = [/^\/$/, /^\/students(\/|$)/, /^\/calendar$/, /^\/messages(\/|$)/, /^\/settings$/, /^\/store$/];

export function middleware(req: NextRequest): NextResponse {
  const code = schoolCodeFromHost(req.headers.get("host"));
  if (code) return schoolAddress(req, code);
  if (!PROTECTED.some((re) => re.test(req.nextUrl.pathname))) return NextResponse.next();
  return requireSession(req);
}

// A school's own address, "<code>.schoolkit.ng" (docs/modules/school-addresses.md).
// It serves three public pages; everything else, signing in included, lives on
// the portal's own address, so sessions never spread across schools' hosts.
//   /                 the school's front page
//   /apply[/...]      the admission form and its tracking pages
//   /results          the result checker
//   /news[/<post>]    the school's news (docs/modules/school-website.md)
//   /gallery          its photo gallery
//   /id/...           ID card checks, as anywhere
function schoolAddress(req: NextRequest, code: string): NextResponse {
  const path = req.nextUrl.pathname;
  const rewrite = (to: string) => {
    const url = req.nextUrl.clone();
    url.pathname = to;
    return NextResponse.rewrite(url);
  };
  if (path === "/") return rewrite(`/school/${code}`);
  if (path === "/apply" || path.startsWith("/apply/")) return rewrite(`/apply/${code}${path.slice("/apply".length)}`);
  if (path === "/results") return rewrite(`/result-checker/${code}`);
  if (path === "/news" || /^\/news\/[0-9a-f-]{36}$/i.test(path) || path === "/gallery") return rewrite(`/school/${code}${path}`);
  if (path.startsWith("/id/")) return NextResponse.next();
  const target = new URL(`${PORTAL_URL}${path}${req.nextUrl.search}`);
  if (path === "/login") target.searchParams.set("school", code);
  return NextResponse.redirect(target);
}

function requireSession(req: NextRequest): NextResponse {
  const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value);

  if (!hasSession) {
    const login = new URL("/login", req.url);
    // Preserve the intended destination so a guardian who followed a link to
    // a specific child (or clicked one in a reminder email) lands there after
    // signing in, rather than on a generic home screen. Only the path+query
    // is carried, never an absolute URL — see the `next` handling in
    // login/page.tsx for the open-redirect guard on the way back out.
    const target = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    if (target && target !== "/") {
      login.searchParams.set("next", target);
    }
    const res = NextResponse.redirect(login);
    // Belt and braces: if the cookie is absent because it EXPIRED rather
    // than because the visitor never had one, make sure no stale copy
    // lingers under a different attribute set.
    res.cookies.delete(COOKIE_NAME);
    return res;
  }

  const res = NextResponse.next();
  // Authenticated pages must not sit in a shared browser's disk cache or be
  // restorable from the back/forward cache after sign-out. This is the other
  // half of the shared-device story: the Sign out button destroys the
  // session server-side, and these headers stop the already-rendered
  // document being handed back by the browser afterwards.
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.headers.set("Pragma", "no-cache");
  return res;
}

// PROTECTED (above) is the gate: only the authenticated surfaces. /calendar
// joined on 2026-09-13 (Phase 8 / CP1) — it is authenticated like the others,
// and needs the same no-store headers on a shared device. Until 2026-10-22
// this list was the matcher itself.
//
// NOT protected, and each for a reason:
//   /login                     — the destination of the redirect; matching it
//                                would loop.
//   /invitations/:token        — public by design, the token is the auth.
//   /student-invite/:token     — same.
//   /reset-password/:token     — same; a guardian resetting a password has no
//                                session, which is the entire point.
//   /payments/callback         — Paystack redirects here from its own domain.
//                                It reads a reference from the query string
//                                and verifies it against the API; forcing a
//                                login redirect mid-payment-return would
//                                strand a parent who has just paid.
//   /api/*                     — the proxy route handles its own auth by
//                                forwarding (or not forwarding) the cookie.
//
// The matcher now takes every page (2026-10-22), because a school's address can
// arrive on any path; Next's own files, the API proxy and static assets stay
// out. Which pages need a session is the PROTECTED list above.
export const config = {
  matcher: ["/((?!_next/|api/|favicon|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)$).*)"],
};
