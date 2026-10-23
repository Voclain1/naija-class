import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { PublicWebsiteGalleryDto } from "@school-kit/types";

import { ReportButton } from "@/components/school-site/report-button";
import { SchoolSiteShell } from "@/components/school-site/school-site-shell";
import { fetchSchoolSite, loadSchool, onSchoolAddress } from "@/lib/school-site";

// The school's photo gallery (docs/modules/school-website.md), by album. No
// pupils (W4); a "Report" link under every photo.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const school = await loadSchool((await params).code).catch(() => null);
  return { title: school ? `Gallery · ${school.name}` : "School not found" };
}

export default async function SchoolGalleryPage({ params }: Params) {
  const { code } = await params;
  const [school, gallery] = await Promise.all([loadSchool(code), fetchSchoolSite<PublicWebsiteGalleryDto>(`${encodeURIComponent(code)}/gallery`)]);
  if (!school || !gallery) notFound();
  const own = await onSchoolAddress();
  const heading = school.website.accent ? { color: school.website.accent } : undefined;

  return (
    <SchoolSiteShell school={school} own={own}>
      <h1 className="text-2xl font-semibold" style={heading}>
        Gallery
      </h1>
      {gallery.albums.length === 0 && <p className="text-sm text-muted-foreground">No photos yet.</p>}
      {gallery.albums.map((album) => (
        <section key={album.id ?? "loose"} className="flex flex-col gap-3" aria-label={album.title}>
          <h2 className="text-lg font-semibold">{album.title}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {album.photos.map((p) => (
              <li key={p.id} className="flex flex-col gap-1">
                <a href={p.largeUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL */}
                  <img src={p.thumbUrl} alt={p.caption ?? ""} className="aspect-[4/3] w-full rounded object-cover" />
                </a>
                {p.caption && <span className="text-xs text-muted-foreground">{p.caption}</span>}
                <ReportButton code={school.code} target={{ photoId: p.id }} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SchoolSiteShell>
  );
}
