import { schoolCodeFromHost, SCHOOL_ADDRESS_DOMAIN } from "./school-host";

// Where a redirect from this app's server code should point
// (docs/modules/school-hosted-apps.md).
//
// At a school's own address the request reaches us through the portal, which
// forwards /staff here and names the address the browser is on in
// x-schoolkit-host. A redirect built on our own host would move a member of
// staff from virgo.schoolkit.ng to app.schoolkit.ng, so it is built on that
// address instead. Only a school address is believed: anything else in the
// header gives our own origin, so the header can never send anyone off
// schoolkit.ng.
export const SCHOOL_HOST_HEADER = "x-schoolkit-host";

export function publicOrigin(headers: Headers, ownOrigin: string, domain: string = SCHOOL_ADDRESS_DOMAIN): string {
  const host = headers.get(SCHOOL_HOST_HEADER);
  if (!host || !schoolCodeFromHost(host, domain)) return ownOrigin;
  const local = /^localhost(:\d+)?$/.test(domain);
  return `${local ? "http" : "https"}://${host.toLowerCase()}`;
}
