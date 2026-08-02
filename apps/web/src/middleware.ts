// Edge middleware — first-pass session gate.
//
// Paths are derived from the actual directory tree:
//   (admin) route group → /dashboard, /settings/*, /students/*, /staff/*,
//                          /guardians/*, /enrollments/*, /report-cards/*
//   (teacher) route group → /teacher/*
//   super-admin/dashboard → the platform-admin surface (real URL segment,
//                          not a route group — see CLAUDE.md's "Platform
//                          super-admin" note). Gated on its OWN cookie,
//                          sk_platform_session, entirely separate from
//                          sk_session — a staff session cookie alone
//                          satisfies neither gate for the other's routes.
//
// Deliberately NOT included:
//   /onboarding          — accessed immediately after signup, before the
//                          session cookie exists; gating it breaks signup.
//   /invitations         — public invitation-accept pages; unauthenticated
//                          users land here from email links.
//   /login /signup /debug — already public or dev-only.
//   /super-admin/login   — the platform-admin surface's own public login
//                          page; gating it would make signing in impossible.
//   /api/*               — our own route handlers; they do their own auth.
//
// The matcher config is the gate: the middleware function never even runs
// for un-listed paths, so there is no in-function path check needed.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const COOKIE_NAME = "sk_session";
const PLATFORM_ADMIN_COOKIE_NAME = "sk_platform_session";

export function middleware(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith("/super-admin")) {
    if (req.cookies.has(PLATFORM_ADMIN_COOKIE_NAME)) return NextResponse.next();
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/super-admin/login";
    return NextResponse.redirect(loginUrl);
  }

  if (req.cookies.has(COOKIE_NAME)) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/students/:path*",
    "/staff/:path*",
    "/guardians/:path*",
    "/enrollments/:path*",
    "/report-cards/:path*",
    "/teacher/:path*",
    "/super-admin/dashboard/:path*",
  ],
};
