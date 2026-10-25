import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { PublicWebsiteGalleryDto } from "@school-kit/types";

import { ReportButton } from "@/components/school-site/report-button";
import { SchoolSiteShell, SubPageHead } from "@/components/school-site/school-site-shell";
import { fetchSchoolSite, loadSchool, onSchoolAddress, siteHref } from "@/lib/school-site";

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

  return (
    <SchoolSiteShell school={school} own={own}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-12 sm:px-6 sm:pt-16">
        <SubPageHead id="gallery" eyebrow="Life at school" title="Gallery" back={{ href: siteHref(school.code, own, ""), label: school.name }} />
        {gallery.albums.length === 0 && <p className="ss-lead">No photos yet.</p>}
        <div className="flex flex-col gap-14">
          {gallery.albums.map((album) => (
            <section key={album.id ?? "loose"} className="flex flex-col gap-5" aria-label={album.title} data-ss-reveal>
              <h2 className="text-2xl font-extrabold tracking-tight">{album.title}</h2>
              <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {album.photos.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2">
                    <a href={p.largeUrl} target="_blank" rel="noreferrer" className="ss-img-zoom block rounded-[1.2rem]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL */}
                      <img src={p.thumbUrl} alt={p.caption ?? ""} className="aspect-[4/3] w-full rounded-[1.2rem] object-cover" />
                    </a>
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm ss-muted">{p.caption}</span>
                      <ReportButton code={school.code} target={{ photoId: p.id }} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </SchoolSiteShell>
  );
}
