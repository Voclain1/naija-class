// Preview deployments only: the browser's API calls come here, and this
// forwards them to the API with the session as a bearer token.
//
// Why (docs/deferred.md, "Staff sign-in does not work on Vercel preview
// deployments"): production pages call api.schoolkit.ng directly and the
// browser sends the sk_session cookie, which carries Domain=schoolkit.ng.
// A preview runs on *.vercel.app, so the browser never sends that cookie to
// the API, and the API does not accept the preview's origin anyway. Routing a
// preview's calls through its own origin fixes both, and the token still
// never reaches page JavaScript: it is read from the HttpOnly cookie here, on
// the server.
//
// Not used in production, deliberately: Vercel caps a function's request body
// at 4.5 MB, which would break register-photo, curriculum and CSV uploads.
// That limit is acceptable on a preview. The route answers 404 unless this is
// a preview build, so it cannot become a second way into production.
//
// Cross-site requests: the cookie is SameSite=Lax, so another site cannot make
// the browser send it on a POST. A write must also come from this origin.

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/server/session-cookie";

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
}

// Response headers worth passing back; hop-by-hop and encoding headers are not
// (fetch has already decoded the body).
const PASS_HEADERS = ["content-type", "content-disposition", "cache-control", "etag", "last-modified"];

function previewProxyEnabled(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  if (!previewProxyEnabled()) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }

  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (!origin || origin !== req.nextUrl.origin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Cross-site request refused." } },
        { status: 403 },
      );
    }
  }

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = req.headers.get("accept");
  if (accept) headers.set("accept", accept);
  if (token) headers.set("authorization", `Bearer ${token}`);

  const target = `${apiBase()}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return NextResponse.json(
      { error: { code: "NETWORK_ERROR", message: "Couldn't reach the server." } },
      { status: 502 },
    );
  }

  const out = new NextResponse(upstream.status === 204 ? null : upstream.body, { status: upstream.status });
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.headers.set(name, value);
  }
  return out;
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
