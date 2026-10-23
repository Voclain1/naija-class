import { RESERVED_SLUGS } from "@school-kit/types";

// Whether a browser Origin is one of the schools' own addresses,
// "https://<code>.schoolkit.ng" (docs/modules/school-addresses.md slice 2).
//
// The school's front page, admission form and result checker call the API
// straight from the browser (per-family rate limits, as on the portal), so the
// API's CORS list must allow every school address. Since 2026-10-23 the staff
// area is served at the school's address too (<code>.schoolkit.ng/staff,
// docs/modules/school-hosted-apps.md), so school addresses are allowed WITH
// credentials, and the staff session cookie is accepted from one only for a
// session of that same school (staff-session-token.ts, auth.guard.ts).
//
// SCHOOL_ADDRESS_DOMAIN names the domain ("schoolkit.ng"). Unset, no school
// address is allowed. In development, "localhost:3002" allows
// "http://<code>.localhost:3002", which browsers resolve to this machine.

export function isSchoolAddressOrigin(origin: string | undefined, domain: string | undefined): boolean {
  if (!origin || !domain) return false;
  const local = /^localhost(:\d+)?$/.test(domain);
  const scheme = local ? "https?" : "https";
  const pattern = new RegExp(`^${scheme}://[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\\.${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return pattern.test(origin);
}

/**
 * The school code in a school address Origin ("https://virgo.schoolkit.ng" →
 * "virgo"), or null. Our own hosts (app., portal., cbt., api.) have the same
 * shape and are reserved codes no school can hold, so they give null.
 */
export function schoolCodeFromOrigin(origin: string | undefined, domain: string | undefined): string | null {
  if (!origin || !domain || !isSchoolAddressOrigin(origin, domain)) return null;
  const host = origin.replace(/^https?:\/\//, "");
  const code = host.slice(0, host.length - domain.length - 1);
  return RESERVED_SLUGS.has(code) ? null : code;
}
