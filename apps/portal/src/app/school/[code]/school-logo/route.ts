import { NextResponse } from "next/server";

import { loadSchool } from "@/lib/school-site";

// A stable link to the school's logo (docs/modules/school-website.md,
// "Search"). The logo itself sits behind an hour-long signed URL, so search
// engines and link previews are given this address, which redirects to a
// fresh one on each visit. No logo: SchoolKit's mark.

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const school = await loadSchool((await params).code).catch(() => null);
  const to = school?.logoUrl ?? new URL("/brand/schoolkit-icon.png", req.url).toString();
  return NextResponse.redirect(to, { status: 302, headers: { "Cache-Control": "public, max-age=600" } });
}
