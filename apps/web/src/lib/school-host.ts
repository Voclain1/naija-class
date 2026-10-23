// The staff app at a school's own address, "<code>.schoolkit.ng/staff"
// (docs/modules/school-hosted-apps.md). Same parsing as the portal's
// lib/school-host.ts. NEXT_PUBLIC_SCHOOL_ADDRESS_DOMAIN names the domain
// ("schoolkit.ng"); unset, no host is a school's.

export const SCHOOL_ADDRESS_DOMAIN = process.env.NEXT_PUBLIC_SCHOOL_ADDRESS_DOMAIN ?? "";

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const OWN_HOSTS = new Set(["www", "app", "portal", "api", "cbt", "admin", "mail", "status", "docs", "help", "blog"]);

/** The school code a host names, or null for SchoolKit's own hosts and anything else. */
export function schoolCodeFromHost(host: string | null | undefined, domain: string = SCHOOL_ADDRESS_DOMAIN): string | null {
  if (!host || !domain) return null;
  const h = host.toLowerCase();
  const suffix = `.${domain.toLowerCase()}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  if (!LABEL_RE.test(label) || OWN_HOSTS.has(label)) return null;
  return label;
}

/** The school code of the address this page is open at, or null. Browser only. */
export function schoolCodeHere(): string | null {
  return typeof window === "undefined" ? null : schoolCodeFromHost(window.location.host);
}
