// School addresses, "<code>.schoolkit.ng" (docs/modules/school-addresses.md
// slice 2). The portal serves every school's front page, admission form and
// result checker at the school's own address, and since 2026-10-23 its
// parents' pages under /parents and the staff app under /staff
// (docs/modules/school-hosted-apps.md).
//
// Plain host parsing, no platform features: the same code runs on Vercel and
// on a VPS behind a wildcard proxy. NEXT_PUBLIC_SCHOOL_ADDRESS_DOMAIN names the
// domain ("schoolkit.ng"); in development "localhost:3002" serves
// "<code>.localhost:3002". Unset, no host is a school's.

export const SCHOOL_ADDRESS_DOMAIN = process.env.NEXT_PUBLIC_SCHOOL_ADDRESS_DOMAIN ?? "";
/** The portal's own address, where parents sign in. */
export const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3002").replace(/\/$/, "");
/** The staff web app, where staff sign in. */
export const STAFF_URL = (process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3001").replace(/\/$/, "");

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

// SchoolKit's own hosts under the domain: never a school. Kept here rather than
// importing RESERVED_SLUGS so middleware stays free of the types package (it
// runs on the edge). A reserved word that is not a host simply finds no school.
const OWN_HOSTS = new Set(["www", "app", "portal", "api", "cbt", "admin", "mail", "status", "docs", "help", "blog"]);

/** The school code a request's Host names, or null for SchoolKit's own hosts and anything else. */
export function schoolCodeFromHost(host: string | null | undefined, domain: string = SCHOOL_ADDRESS_DOMAIN): string | null {
  if (!host || !domain) return null;
  const h = host.toLowerCase();
  const suffix = `.${domain.toLowerCase()}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  if (!LABEL_RE.test(label) || OWN_HOSTS.has(label)) return null;
  return label;
}

/** "https://<code>.schoolkit.ng" + path, or null when addresses are not set up here. */
export function schoolAddressUrl(code: string, path = "/", domain: string = SCHOOL_ADDRESS_DOMAIN): string | null {
  if (!domain) return null;
  const local = /^localhost(:\d+)?$/.test(domain);
  return `${local ? "http" : "https"}://${code}.${domain}${path}`;
}
