import { NextResponse, type NextRequest } from "next/server";

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

export function middleware(req: NextRequest): NextResponse {
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

// The matcher IS the gate — the function above never runs for anything not
// listed here. Deliberately narrow: only the two authenticated surfaces.
//
// NOT matched, and each for a reason:
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
export const config = {
  matcher: ["/", "/students/:path*"],
};
