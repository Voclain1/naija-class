import { headers } from "next/headers";

import { schoolCodeFromHost } from "@/lib/school-host";
import { portalRobotsTxt, schoolRobotsTxt } from "@/lib/sitemap-xml";

// /robots.txt (docs/modules/school-website.md, "Search"): per address. A
// school's address opens its public pages; the portal's opens only the
// schools' public pages.

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const body = schoolCodeFromHost(host) ? schoolRobotsTxt(`${origin}/sitemap.xml`) : portalRobotsTxt(`${origin}/sitemap.xml`);
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
