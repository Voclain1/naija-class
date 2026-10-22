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

export function schoolSiteUrls(code: string): SchoolSiteUrls {
  if (schoolAddressesLive()) {
    const domain = process.env.SCHOOL_ADDRESS_DOMAIN as string;
    const local = /^localhost(:\d+)?$/.test(domain);
    const base = `${local ? "http" : "https"}://${code}.${domain}`;
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

/** The three links SchoolMeDto carries (no tracking link: that needs a token). */
export function publicSiteUrls(code: string): { home: string; apply: string; results: string } {
  const { home, apply, results } = schoolSiteUrls(code);
  return { home, apply, results };
}
