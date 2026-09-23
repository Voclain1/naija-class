import { NextResponse, type NextRequest } from "next/server";

import { setSessionCookie } from "@/lib/server/session-cookie";

// Opening the website from the app, already signed in
// (docs/modules/web-handoff-signin.md).
//
// A GET, because it is the target of a redirect from the phone's browser:
// the app opens https://app.schoolkit.ng/handoff?t=…&next=/finance, this
// trades the one-time token for a real session, sets the sk_session HttpOnly
// cookie exactly as login does, and redirects on.
//
// It is a ROUTE HANDLER rather than a page on purpose: the exchange must
// happen server-side so the session token never reaches the browser's
// JavaScript, and a page would either render first or need a client fetch.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/**
 * Only a path on this site (H5). Anything else — a scheme, a host, a
 * protocol-relative "//host", a climb with ".." — would make this link an
 * open redirect wearing the school's own domain, which is worse than no
 * handoff at all.
 *
 * Checked HERE as well as in the API's schema: this is the code that
 * actually performs the redirect, and a guard on the other side of a network
 * hop is a guard someone can forget to keep.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("..")) return "/dashboard";
  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("t");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const origin = request.nextUrl.origin;

  // A failed handoff lands on the ordinary sign-in page with an explanation,
  // never a blank screen: the person still has a password and a keyboard.
  const failed = NextResponse.redirect(new URL("/login?handoff=expired", origin));

  if (!token) return failed;

  try {
    const response = await fetch(`${API_BASE}/auth/web-handoff/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    if (!response.ok) return failed;

    const data = (await response.json()) as { token?: string };
    if (!data.token) return failed;

    const out = NextResponse.redirect(new URL(next, origin));
    setSessionCookie(out, data.token);
    return out;
  } catch {
    // The API is unreachable. Same landing: sign in the ordinary way.
    return failed;
  }
}
