// Edge middleware — first-pass session gate.
//
// Paths are derived from the actual directory tree:
//   (admin) route group → /dashboard, /settings/*, /students/*, /staff/*,
//                          /guardians/*, /enrollments/*, /report-cards/*
//   (teacher) route group → /teacher/*
//
// Deliberately NOT included:
//   /onboarding   — accessed immediately after signup, before the session
//                   cookie exists; gating it breaks the signup flow.
//   /invitations  — public invitation-accept pages; unauthenticated users
//                   land here from email links.
//   /login /signup /debug — already public or dev-only.
//   /api/*        — our own route handlers; they do their own auth.
//
// The matcher config is the gate: the middleware function never even runs
// for un-listed paths, so there is no in-function path check needed.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const COOKIE_NAME = "sk_session";

export function middleware(req: NextRequest): NextResponse {
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
  ],
};
