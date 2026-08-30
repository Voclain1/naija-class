// Public proxy for the two student-invitation endpoints.
//
// Deliberately SEPARATE from /api/portal/[...portal], and deliberately much
// smaller, for one reason: that route's whole job is managing the
// sk_portal_session cookie, and this one must never set a cookie at all.
//
// WHY NO COOKIE. Accepting an invitation returns a STUDENT session token.
// Storing it in this browser would put a child's session in whatever browser
// the invite link happened to be opened in — very often the guardian's own
// phone, on a shared family handset, right next to the guardian's session.
// The student's real client is apps/mobile (ADR-002: bearer token in the OS
// keychain). So this page's job ends at "the password is set" and the child
// signs in on the app. The token in the response is discarded here.
//
// Only two paths are permitted, and they are allowlisted rather than
// pattern-matched: this proxy is unauthenticated, so anything reachable
// through it is reachable by anyone with the URL.

import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** Exactly the two public invitation endpoints. Nothing else. */
function isAllowed(segments: string[], method: string): boolean {
  if (segments[0] !== "invitations" || segments.length < 2) return false;
  if (method === "GET") return segments.length === 2;
  if (method === "POST") return segments.length === 3 && segments[2] === "accept";
  return false;
}

async function forward(req: NextRequest, segments: string[]): Promise<NextResponse> {
  if (!isAllowed(segments, req.method)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found." } },
      { status: 404 },
    );
  }

  const body = req.method === "POST" ? await req.text() : undefined;

  try {
    // Same defensive shape as the guardian proxy: a fetch failure here must
    // return the app's standard error envelope, not Next's generic HTML 500,
    // or the page will report "invalid link" for what is actually a
    // misconfigured NEXT_PUBLIC_API_URL. That exact bug shipped once already
    // — see the guardian proxy's header.
    const resp = await fetch(`${API_BASE}/student-portal/${segments.join("/")}`, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body } : {}),
    });
    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "API_UNREACHABLE",
          message: "We couldn't reach SchoolKit. Please try again shortly.",
        },
      },
      { status: 502 },
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return forward(req, (await params).path);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return forward(req, (await params).path);
}
