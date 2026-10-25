import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { PublicWebsiteNewsDto } from "@school-kit/types";

import { ArrowRight } from "@/components/school-site/icons";
import { SchoolSiteShell, SubPageHead } from "@/components/school-site/school-site-shell";
import { JsonLd } from "@/components/school-site/json-ld";
import { breadcrumbJsonLd, newsMetadata } from "@/lib/school-seo";
import { fetchSchoolSite, formatPublished, loadSchool, onSchoolAddress, siteHref } from "@/lib/school-site";

// The school's news (docs/modules/school-website.md): its published posts,
// newest first, as many as its plan shows.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const school = await loadSchool((await params).code).catch(() => null);
  return school ? newsMetadata(school) : { title: "School not found", robots: { index: false } };
}

export default async function SchoolNewsPage({ params, searchParams }: Params) {
  const { code } = await params;
  const page = Number((await searchParams).page ?? "1") || 1;
  const [school, news] = await Promise.all([
    loadSchool(code),
    fetchSchoolSite<PublicWebsiteNewsDto>(`${encodeURIComponent(code)}/news?page=${page}`),
  ]);
  if (!school || !news) notFound();
  const own = await onSchoolAddress();
  const pageHref = (n: number) => `${siteHref(school.code, own, "/news")}?page=${n}`;

  return (
    <SchoolSiteShell school={school} own={own}>
      <JsonLd data={breadcrumbJsonLd(school, [{ name: "News", url: school.seo.urls.news }])} />
      <section className="mx-auto w-full max-w-6xl px-4 pb-8 pt-12 sm:px-6 sm:pt-16" aria-labelledby="news">
        <SubPageHead id="news" eyebrow="From the school" title="News" back={{ href: siteHref(school.code, own, ""), label: school.name }} />
        {news.posts.length === 0 && <p className="ss-lead">No news yet.</p>}
        <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {news.posts.map((p) => (
            <li key={p.id}>
              <Link href={siteHref(school.code, own, `/news/${p.id}`)} className="ss-card ss-img-zoom flex h-full flex-col">
                {p.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL
                  <img src={p.photo.thumbUrl} alt={p.photo.caption ?? p.title} loading="lazy" decoding="async" width={480} height={300} className="aspect-[16/10] w-full rounded-t-[1.4rem] object-cover" />
                ) : (
                  <span className="aspect-[16/10] w-full rounded-t-[1.4rem] bg-[var(--sa-soft)]" aria-hidden />
                )}
                <span className="flex flex-1 flex-col gap-2 p-6">
                  <span className="text-sm font-semibold text-[var(--sa)]">{formatPublished(p.publishedAt)}</span>
                  <span className="text-lg font-bold leading-snug">{p.title}</span>
                  <span className="ss-muted line-clamp-3">{p.excerpt}</span>
                  <span className="ss-btn-text mt-auto pt-2 text-sm" style={{ color: "var(--sa)" }}>
                    Read more <ArrowRight className="ss-arrow" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {news.pages > 1 && (
          <nav aria-label="Pages" className="mt-10 flex items-center justify-center gap-3">
            {news.page > 1 && (
              <Link href={pageHref(news.page - 1)} className="ss-btn ss-btn-quiet">
                Newer
              </Link>
            )}
            <span className="px-3 ss-muted">
              Page {news.page} of {news.pages}
            </span>
            {news.page < news.pages && (
              <Link href={pageHref(news.page + 1)} className="ss-btn ss-btn-quiet">
                Older
              </Link>
            )}
          </nav>
        )}
      </section>
    </SchoolSiteShell>
  );
}
