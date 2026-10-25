import { headers } from "next/headers";

import type { SchoolSitemapDto, SchoolSitemapIndexDto } from "@school-kit/types";

import { API_BASE, fetchSchoolSite } from "@/lib/school-site";
import { schoolCodeFromHost } from "@/lib/school-host";
import { sitemapIndexXml, urlsetXml } from "@/lib/sitemap-xml";

// /sitemap.xml (docs/modules/school-website.md, "Search"). On a school's own
// address, that school's pages; on the portal's, an index of every school's
// sitemap, which Search Console reads for the whole schoolkit.ng property.

export const dynamic = "force-dynamic";

const XML = { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" };

export async function GET() {
  const code = schoolCodeFromHost((await headers()).get("host"));
  if (code) {
    const map = await fetchSchoolSite<SchoolSitemapDto>(`${encodeURIComponent(code)}/sitemap`).catch(() => null);
    if (!map) return new Response("Not found", { status: 404 });
    return new Response(urlsetXml(map.entries), { headers: XML });
  }
  const res = await fetch(`${API_BASE}/school-addresses/sitemap-index`, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return new Response("Unavailable", { status: 503 });
  const index = (await res.json()) as SchoolSitemapIndexDto;
  return new Response(sitemapIndexXml(index.sitemaps), { headers: XML });
}
