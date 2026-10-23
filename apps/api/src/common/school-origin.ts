// Whether a browser Origin is one of the schools' own addresses,
// "https://<code>.schoolkit.ng" (docs/modules/school-addresses.md slice 2).
//
// The school's front page, admission form and result checker call the API
// straight from the browser (per-family rate limits, as on the portal), so the
// API's CORS list must allow every school address. It allows them WITHOUT
// credentials: the staff session cookie is only ever accepted from the staff
// web app's own origin (main.ts, staff-session-token.ts).
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
