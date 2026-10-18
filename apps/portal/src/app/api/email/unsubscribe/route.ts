// Phase 9 / CP8.3 — the unsubscribe link in announcement emails
// (docs/modules/phase-9.md §17.11). PUBLIC: no session cookie is read or set.
//
//   GET  ?s&e&t           → is this address subscribed? (the page)
//   POST JSON {s,e,t,subscribe} → unsubscribe or undo (the page's buttons)
//   POST ?s&e&t, form body "List-Unsubscribe=One-Click" → a mail app's
//                           one-click unsubscribe (RFC 8058), from the
//                           List-Unsubscribe header in every email.
//
// Kept apart from /api/portal/[...portal], which forwards only to /portal/*
// and carries the parent's session.

import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { clientIpHeaders } from "@/lib/client-ip-signature";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

async function forward(method: "GET" | "POST", path: string, body?: string): Promise<NextResponse> {
  const headerList = await headers();
  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...clientIpHeaders((name) => headerList.get(name)) },
      ...(body !== undefined ? { body } : {}),
    });
    const data: unknown = await resp.json().catch(() => null);
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: { code: "UPSTREAM_UNREACHABLE", message: "Could not reach the server. Try again in a moment." } }, { status: 502 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return forward("GET", `/email/unsubscribe${req.nextUrl.search}`);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("application/json")) return forward("POST", "/email/unsubscribe", await req.text());
  // One-click: the three values are in the query string; the form body is
  // always "List-Unsubscribe=One-Click" and carries nothing else.
  return forward("POST", `/email/unsubscribe/one-click${req.nextUrl.search}`);
}
