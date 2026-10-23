import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { PublicWebsiteNewsDto } from "@school-kit/types";

import { SchoolSiteShell } from "@/components/school-site/school-site-shell";
import { fetchSchoolSite, formatPublished, loadSchool, onSchoolAddress, siteHref } from "@/lib/school-site";

// The school's news (docs/modules/school-website.md): its published posts,
// newest first, as many as its plan shows.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const school = await loadSchool((await params).code).catch(() => null);
  return { title: school ? `News · ${school.name}` : "School not found" };
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
  const heading = school.website.accent ? { color: school.website.accent } : undefined;
  const pageHref = (n: number) => `${siteHref(school.code, own, "/news")}?page=${n}`;

  return (
    <SchoolSiteShell school={school} own={own}>
      <section className="flex flex-col gap-4" aria-labelledby="news">
        <h1 id="news" className="text-2xl font-semibold" style={heading}>
          News
        </h1>
        {news.posts.length === 0 && <p className="text-sm text-muted-foreground">No news yet.</p>}
        <ul className="flex flex-col gap-4">
          {news.posts.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row">
              {p.photo && (
                // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL
                <img src={p.photo.thumbUrl} alt={p.photo.caption ?? ""} className="aspect-[4/3] w-full rounded object-cover sm:w-48" />
              )}
              <div className="flex flex-col gap-1">
                <Link href={siteHref(school.code, own, `/news/${p.id}`)} className="text-lg font-medium hover:underline">
                  {p.title}
                </Link>
                <span className="text-xs text-muted-foreground">{formatPublished(p.publishedAt)}</span>
                <p className="text-sm text-muted-foreground">{p.excerpt}</p>
              </div>
            </li>
          ))}
        </ul>
        {news.pages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-4 text-sm">
            {news.page > 1 && <Link href={pageHref(news.page - 1)}>Newer</Link>}
            <span className="text-muted-foreground">
              Page {news.page} of {news.pages}
            </span>
            {news.page < news.pages && <Link href={pageHref(news.page + 1)}>Older</Link>}
          </nav>
        )}
      </section>
    </SchoolSiteShell>
  );
}
