import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { PublicWebsitePostDto } from "@school-kit/types";

import { ReportButton } from "@/components/school-site/report-button";
import { SchoolSiteShell } from "@/components/school-site/school-site-shell";
import { fetchSchoolSite, formatPublished, loadSchool, onSchoolAddress, siteHref } from "@/lib/school-site";

// One news post (docs/modules/school-website.md), with its photos and a
// "Report" link under each.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string; postId: string }> };

async function load(code: string, postId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return null;
  return fetchSchoolSite<PublicWebsitePostDto>(`${encodeURIComponent(code)}/news/${postId}`);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code, postId } = await params;
  const [school, post] = await Promise.all([loadSchool(code).catch(() => null), load(code, postId).catch(() => null)]);
  return { title: school && post ? `${post.title} · ${school.name}` : "Not found" };
}

export default async function SchoolPostPage({ params }: Params) {
  const { code, postId } = await params;
  const [school, post] = await Promise.all([loadSchool(code), load(code, postId)]);
  if (!school || !post) notFound();
  const own = await onSchoolAddress();

  return (
    <SchoolSiteShell school={school} own={own}>
      <article className="flex flex-col gap-4">
        <Link href={siteHref(school.code, own, "/news")} className="text-sm text-muted-foreground hover:underline">
          ← All news
        </Link>
        <h1 className="text-2xl font-semibold" style={school.website.accent ? { color: school.website.accent } : undefined}>
          {post.title}
        </h1>
        <p className="text-sm text-muted-foreground">{formatPublished(post.publishedAt)}</p>
        {post.photos.map((p) => (
          <figure key={p.id} className="flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL */}
            <img src={p.largeUrl} alt={p.caption ?? ""} className="w-full rounded-lg object-cover" />
            <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{p.caption}</span>
              <ReportButton code={school.code} target={{ photoId: p.id }} />
            </figcaption>
          </figure>
        ))}
        <div className="whitespace-pre-line text-base leading-relaxed">{post.body}</div>
        <ReportButton code={school.code} target={{ postId: post.id }} label="Report this post" />
      </article>
    </SchoolSiteShell>
  );
}
