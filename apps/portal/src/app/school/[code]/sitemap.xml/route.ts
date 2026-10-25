import type { SchoolSitemapDto } from "@school-kit/types";

import { fetchSchoolSite } from "@/lib/school-site";
import { urlsetXml } from "@/lib/sitemap-xml";

// One school's sitemap on the portal's address (docs/modules/school-website.md,
// "Search"). On the school's own address, /sitemap.xml serves the same list.

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const map = await fetchSchoolSite<SchoolSitemapDto>(`${encodeURIComponent((await params).code)}/sitemap`).catch(() => null);
  if (!map) return new Response("Not found", { status: 404 });
  return new Response(urlsetXml(map.entries), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
