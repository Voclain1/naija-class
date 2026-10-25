import { portalBaseUrl } from "./portal-url.js";

// A school's public links, in ONE place (docs/modules/school-addresses.md).
//
// Before SCHOOL_ADDRESSES_LIVE is on, every link stays on the portal's address
// (portal.schoolkit.ng/apply/<code>, …), exactly as before. Once the wildcard
// DNS and certificate are in place and the switch is on, links use the school's
// own address (<code>.schoolkit.ng/apply). Both forms keep working either way,
// so turning it on or off never breaks a link already sent or printed.

export interface SchoolSiteUrls {
  home: string;
  apply: string;
  results: string;
  track(token: string): string;
}

export function schoolAddressesLive(): boolean {
  return process.env.SCHOOL_ADDRESSES_LIVE === "on" && !!process.env.SCHOOL_ADDRESS_DOMAIN;
}

/** "https://<code>.<domain>", or null while addresses are not live. */
function schoolOrigin(code: string | null | undefined): string | null {
  if (!code || !schoolAddressesLive()) return null;
  const domain = process.env.SCHOOL_ADDRESS_DOMAIN as string;
  const local = /^localhost(:\d+)?$/.test(domain);
  return `${local ? "http" : "https"}://${code}.${domain}`;
}

function webBaseUrl(): string {
  return (process.env.WEB_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

// Schools work from their own address (docs/modules/school-hosted-apps.md):
// parents at <code>.schoolkit.ng/parents, staff at <code>.schoolkit.ng/staff.
// Every link we send to a parent or a member of staff is built here. While
// addresses are not live, or with no school to hand (new-school sign-up), the
// link stays on the portal's or the staff app's own address, which keeps
// working either way: the staff app redirects its old paths to /staff.

/** A link into the parents' area: `path` as the portal names it ("/invitations/x"). */
export function parentSiteUrl(code: string | null | undefined, path: string): string {
  const origin = schoolOrigin(code);
  return origin ? `${origin}/parents${path}` : `${portalBaseUrl().replace(/\/$/, "")}${path}`;
}

/** A link into the staff area: `path` as the staff app names it ("/invitations/x"). */
export function staffSiteUrl(code: string | null | undefined, path: string): string {
  const origin = schoolOrigin(code);
  return origin ? `${origin}/staff${path}` : `${webBaseUrl()}${path}`;
}

export function schoolSiteUrls(code: string): SchoolSiteUrls {
  const base = schoolOrigin(code);
  if (base) {
    return {
      home: `${base}/`,
      apply: `${base}/apply`,
      results: `${base}/results`,
      track: (token) => `${base}/apply/track/${token}`,
    };
  }
  const portal = portalBaseUrl().replace(/\/$/, "");
  return {
    home: `${portal}/school/${code}`,
    apply: `${portal}/apply/${code}`,
    results: `${portal}/result-checker/${code}`,
    track: (token) => `${portal}/apply/${code}/track/${token}`,
  };
}

/**
 * The links SchoolMeDto carries (no tracking link: that needs a token), with
 * where the school's parents and staff sign in.
 */
export function publicSiteUrls(code: string): { home: string; apply: string; results: string; parents: string; staff: string } {
  const { home, apply, results } = schoolSiteUrls(code);
  return { home, apply, results, parents: parentSiteUrl(code, "/login"), staff: staffSiteUrl(code, "/login") };
}

/**
 * The school's public pages for search engines (docs/modules/school-website.md,
 * "Search"): the canonical address of each, on the school's own address once
 * live, else the portal's. Never a URL that does not work yet.
 */
export function schoolSeoUrls(code: string): { home: string; news: string; gallery: string; apply: string; results: string; sitemap: string } {
  const { home, apply, results } = schoolSiteUrls(code);
  const base = home.replace(/\/$/, "");
  return { home, news: `${base}/news`, gallery: `${base}/gallery`, apply, results, sitemap: `${base}/sitemap.xml` };
}
