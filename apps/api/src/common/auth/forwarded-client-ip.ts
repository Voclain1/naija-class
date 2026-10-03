import { createHmac, timingSafeEqual } from "node:crypto";

// The family's address, forwarded by the guardian portal's own server
// (2026-10-05, closing the docs/deferred.md entry of 2026-10-03).
//
// The portal's pages call this API through its server routes
// (apps/portal/src/app/api/portal and .../student-portal), so the connection
// reaching Fly comes from Vercel, and Fly-Client-IP names Vercel. Every
// signed-in parent therefore shared one set of per-address limits: on a
// results morning, the 201st portal request in a minute from ANY family
// would be refused.
//
// The portal now sends the address it received the request from, SIGNED with a
// secret only the two servers hold:
//
//   x-sk-client-ip      the family's address
//   x-sk-client-ip-ts   when the portal signed it, unix seconds
//   x-sk-client-ip-sig  hex HMAC-SHA256(secret, "<ip>|<ts>")
//
// A plain header would be worthless: anyone can send one, and a forged
// address per request would dodge every limit. So the header is honoured ONLY
// when the signature verifies under PORTAL_PROXY_SECRET and the timestamp is
// within FRESHNESS_SECONDS. Anything else — no secret configured, a missing,
// stale or wrong signature — is ignored, and the request is keyed exactly as
// it was before this change. Unset on either side means today's behaviour,
// never a refusal, so the two deploys need not be simultaneous.
//
// The SAME message format and vector are pinned in the portal's own spec
// (apps/portal/src/lib/client-ip-signature.spec.ts); the two must agree.
export const FORWARDED_IP_HEADER = "x-sk-client-ip";
export const FORWARDED_TS_HEADER = "x-sk-client-ip-ts";
export const FORWARDED_SIG_HEADER = "x-sk-client-ip-sig";
export const FRESHNESS_SECONDS = 300;
/** A shorter secret is treated as unset: guessable keys are worse than none. */
export const MIN_SECRET_LENGTH = 32;

export function signClientIp(secret: string, ip: string, ts: number): string {
  return createHmac("sha256", secret).update(`${ip}|${ts}`).digest("hex");
}

type Headers = Record<string, string | string[] | undefined>;
const one = (h: Headers, name: string): string | undefined => {
  const raw = h[name];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** The verified forwarded address, or null when there is none to trust. */
export function verifiedForwardedIp(
  headers: Headers | undefined,
  secret: string | undefined,
  nowSeconds: number,
): string | null {
  if (!headers || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  const ip = one(headers, FORWARDED_IP_HEADER);
  const tsRaw = one(headers, FORWARDED_TS_HEADER);
  const sig = one(headers, FORWARDED_SIG_HEADER);
  if (!ip || !tsRaw || !sig || ip.length > 64 || !/^\d{1,12}$/.test(tsRaw)) return null;
  const ts = Number(tsRaw);
  if (Math.abs(nowSeconds - ts) > FRESHNESS_SECONDS) return null;
  const expected = Buffer.from(signClientIp(secret, ip, ts), "hex");
  const given = /^[0-9a-f]{64}$/i.test(sig) ? Buffer.from(sig, "hex") : null;
  if (!given || given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return ip;
}
