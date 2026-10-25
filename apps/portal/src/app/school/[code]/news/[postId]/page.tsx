import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { PublicWebsitePostDto } from "@school-kit/types";

import { ArrowLeft } from "@/components/school-site/icons";
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

  const [first, ...rest] = post.photos;

  return (
    <SchoolSiteShell school={school} own={own}>
      <article className="mx-auto w-full max-w-3xl px-4 pb-8 pt-12 sm:px-6 sm:pt-16">
        <Link href={siteHref(school.code, own, "/news")} className="ss-btn-text mb-8 text-sm" style={{ color: "var(--sa)" }}>
          <ArrowLeft className="ss-arrow" /> All news
        </Link>
        <p className="mb-4 text-sm font-semibold text-[var(--sa)]">{formatPublished(post.publishedAt)}</p>
        <h1 className="ss-display ss-display-sm mb-10">{post.title}</h1>
        {first && <Photo code={school.code} photo={first} />}
        <div className="ss-lead my-10 whitespace-pre-line !text-[var(--sa-ink)]">{post.body}</div>
        {rest.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2">
            {rest.map((p) => (
              <Photo key={p.id} code={school.code} photo={p} />
            ))}
          </div>
        )}
        <div className="mt-10">
          <ReportButton code={school.code} target={{ postId: post.id }} label="Report this post" />
        </div>
      </article>
    </SchoolSiteShell>
  );
}

function Photo({ code, photo }: { code: string; photo: PublicWebsitePostDto["photos"][number] }) {
  return (
    <figure className="flex flex-col gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL */}
      <img src={photo.largeUrl} alt={photo.caption ?? ""} className="w-full rounded-[1.4rem] object-cover" />
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm ss-muted">
        <span>{photo.caption}</span>
        <ReportButton code={code} target={{ photoId: photo.id }} />
      </figcaption>
    </figure>
  );
}
