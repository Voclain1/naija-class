import { createHmac } from "node:crypto";

// The family's address, signed for the API (2026-10-05, closing the
// docs/deferred.md entry of 2026-10-03).
//
// This portal's pages call the API through its own server routes
// (/api/portal/*, /api/student-portal/*), so the API sees Vercel's address
// and, until this, every signed-in parent shared one set of per-address rate
// limits. These routes now pass along the address the request reached THEM
// from, signed with PORTAL_PROXY_SECRET, which only this server and the API
// hold. The API honours it only if the signature verifies and is fresh
// (apps/api/src/common/auth/forwarded-client-ip.ts); a plain header would let
// anyone pick their own rate-limit bucket.
//
// No secret (or a short one) means no headers at all, and the API keys the
// request on the proxy's address exactly as before. The message format and
// test vector are pinned identically on both sides.
export const MIN_SECRET_LENGTH = 32;

export function signClientIp(secret: string, ip: string, ts: number): string {
  return createHmac("sha256", secret).update(`${ip}|${ts}`).digest("hex");
}

/**
 * The address this request came from, as Vercel reports it: `x-real-ip`,
 * else the first entry of `x-forwarded-for` (Vercel overwrites that header
 * with the real client, so a value a browser sends cannot survive into it).
 */
export function requestClientIp(get: (name: string) => string | null): string | null {
  const real = get("x-real-ip")?.trim();
  if (real) return real;
  const first = get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

/** Headers to add to the API call, or none when there is nothing to sign with. */
export function clientIpHeaders(
  get: (name: string) => string | null,
  secret: string | undefined = process.env.PORTAL_PROXY_SECRET,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const ip = requestClientIp(get);
  if (!ip || ip.length > 64 || !secret || secret.length < MIN_SECRET_LENGTH) return {};
  return {
    "x-sk-client-ip": ip,
    "x-sk-client-ip-ts": String(nowSeconds),
    "x-sk-client-ip-sig": signClientIp(secret, ip, nowSeconds),
  };
}
