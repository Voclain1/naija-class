import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AccentLink, SchoolSiteShell } from "@/components/school-site/school-site-shell";
import { ReportButton } from "@/components/school-site/report-button";
import { formatDateRange, formatPublished, loadSchool, onSchoolAddress, siteHref } from "@/lib/school-site";
import { PORTAL_URL, STAFF_URL, schoolAddressUrl } from "@/lib/school-host";

// A school's front page: "<code>.schoolkit.ng" (docs/modules/school-addresses.md
// slice 2), also reachable at portal.schoolkit.ng/school/<code>. Every school,
// whatever its plan, has the basics: its name and logo, the ways in for
// parents, students and staff, the admission form and the result checker when
// open, its contacts, and one line of footer.
//
// The school's own sections come next, by plan (docs/modules/school-website.md):
// a cover and welcome, about us, quick facts, events and announcements the
// school ticked, news, the gallery, leadership and the admissions box. No
// pupils in any photo (W4), and a report link under each.
//
// Rendered on the server on every visit. An older code redirects to the
// school's current address. `?preview=` shows the editor's draft.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }>; searchParams: Promise<{ preview?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const school = await loadSchool((await params).code).catch(() => null);
  if (!school) return { title: "School not found" };
  return {
    title: school.name,
    description: school.website.cover?.welcome ?? school.motto ?? `${school.name}: sign in, apply for admission and check results.`,
  };
}

export default async function SchoolFrontPage({ params, searchParams }: Params) {
  const { code } = await params;
  const { preview } = await searchParams;
  const school = await loadSchool(code, preview);
  if (!school) notFound();

  const own = await onSchoolAddress();
  if (school.code !== code.toLowerCase()) {
    redirect((own && schoolAddressUrl(school.code)) || `/school/${school.code}`);
  }
  // On the school's own address the public pages are /apply and /results; on
  // the portal's, the longer paths.
  const applyHref = own ? "/apply" : `/apply/${school.code}`;
  const resultsHref = own ? "/results" : `/result-checker/${school.code}`;
  const w = school.website;
  const accent = w.accent;
  const heading = accent ? { color: accent } : undefined;

  return (
    <SchoolSiteShell school={school} own={own} home>
      {w.cover && (
        <section aria-label="Welcome" className="flex flex-col gap-3">
          {w.cover.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL
            <img src={w.cover.photo.largeUrl} alt="" className="aspect-[16/7] w-full rounded-lg object-cover" />
          )}
          {w.cover.welcome && <p className="text-xl font-medium text-foreground">{w.cover.welcome}</p>}
        </section>
      )}

      <section aria-labelledby="sign-in" className="flex flex-col gap-3">
        <h2 id="sign-in" className="text-lg font-semibold" style={heading}>
          Sign in
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <a
            href={`${PORTAL_URL}/login?school=${encodeURIComponent(school.code)}`}
            className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm hover:bg-muted/40"
          >
            <span className="font-medium">Parents</span>
            <span className="text-sm text-muted-foreground">Fees, results, messages and news.</span>
          </a>
          <div className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm">
            <span className="font-medium">Students</span>
            <span className="text-sm text-muted-foreground">
              Sign in on the SchoolKit app with school code <strong className="text-foreground">{school.code}</strong>.
            </span>
          </div>
          <a
            href={`${STAFF_URL}/login?school=${encodeURIComponent(school.code)}`}
            className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm hover:bg-muted/40"
          >
            <span className="font-medium">Staff</span>
            <span className="text-sm text-muted-foreground">Teachers and the school office.</span>
          </a>
        </div>
      </section>

      {(school.admissionsOpen || school.resultChecker) && (
        <section aria-labelledby="for-families" className="flex flex-col gap-3">
          <h2 id="for-families" className="text-lg font-semibold" style={heading}>
            For families
          </h2>
          <div className="flex flex-wrap gap-3">
            {school.admissionsOpen && (
              <AccentLink href={applyHref} accent={accent}>
                Apply for admission
              </AccentLink>
            )}
            {school.resultChecker && (
              <a href={resultsHref} className="rounded-md border bg-card px-4 py-2 text-sm font-medium">
                Check results with a PIN
              </a>
            )}
          </div>
          {w.admissionsBox && (
            <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-4 text-sm">
              {w.admissionsBox.entryClasses.length > 0 && (
                <p>
                  <span className="font-medium">Entry classes: </span>
                  {w.admissionsBox.entryClasses.join(", ")}
                </p>
              )}
              {w.admissionsBox.feesText && (
                <p>
                  <span className="font-medium">Fees: </span>
                  {w.admissionsBox.feesText}
                </p>
              )}
              {w.admissionsBox.visitNote && <p className="whitespace-pre-line">{w.admissionsBox.visitNote}</p>}
            </div>
          )}
        </section>
      )}

      {w.announcements.length > 0 && (
        <section aria-labelledby="announcements" className="flex flex-col gap-3">
          <h2 id="announcements" className="text-lg font-semibold" style={heading}>
            Announcements
          </h2>
          <ul className="flex flex-col gap-3">
            {w.announcements.map((a) => (
              <li key={a.id} className="rounded-lg border bg-card p-4">
                <p className="font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground">{formatPublished(a.date)}</p>
                <p className="mt-2 whitespace-pre-line text-sm">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {w.events.length > 0 && (
        <section aria-labelledby="events" className="flex flex-col gap-3">
          <h2 id="events" className="text-lg font-semibold" style={heading}>
            Coming up
          </h2>
          <ul className="flex flex-col gap-2">
            {w.events.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 rounded-lg border bg-card p-3 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="shrink-0 text-sm font-medium sm:w-64">{formatDateRange(e.startDate, e.endDate)}</span>
                <span className="flex flex-col">
                  <span className="font-medium">{e.title}</span>
                  {e.description && <span className="text-sm text-muted-foreground">{e.description}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {w.news && w.news.latest.length > 0 && (
        <section aria-labelledby="news" className="flex flex-col gap-3">
          <h2 id="news" className="text-lg font-semibold" style={heading}>
            News
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {w.news.latest.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                {p.photo && (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL
                  <img src={p.photo.thumbUrl} alt={p.photo.caption ?? ""} className="aspect-[4/3] w-full rounded object-cover" />
                )}
                <Link href={siteHref(school.code, own, `/news/${p.id}`)} className="font-medium hover:underline">
                  {p.title}
                </Link>
                <span className="text-xs text-muted-foreground">{formatPublished(p.publishedAt)}</span>
                <p className="text-sm text-muted-foreground">{p.excerpt}</p>
              </li>
            ))}
          </ul>
          {w.news.total > w.news.latest.length && (
            <Link href={siteHref(school.code, own, "/news")} className="self-start text-sm font-medium text-primary hover:underline">
              All news
            </Link>
          )}
        </section>
      )}

      {w.about && (
        <section aria-labelledby="about" className="flex flex-col gap-3">
          <h2 id="about" className="text-lg font-semibold" style={heading}>
            About us
          </h2>
          {w.about.headWelcome && (
            <blockquote className="flex flex-col gap-2 rounded-lg bg-muted/50 p-4">
              <p className="whitespace-pre-line text-sm">{w.about.headWelcome}</p>
              {(w.about.headName || w.about.headTitle) && (
                <footer className="text-sm font-medium">
                  {[w.about.headName, w.about.headTitle].filter(Boolean).join(", ")}
                </footer>
              )}
            </blockquote>
          )}
          {w.about.story && <p className="whitespace-pre-line text-sm">{w.about.story}</p>}
        </section>
      )}

      {w.facts.length > 0 && (
        <section aria-labelledby="facts" className="flex flex-col gap-3">
          <h2 id="facts" className="text-lg font-semibold" style={heading}>
            Quick facts
          </h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            {w.facts.map((f) => (
              <div key={f.label} className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd className="font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {w.leaders.length > 0 && (
        <section aria-labelledby="leaders" className="flex flex-col gap-3">
          <h2 id="leaders" className="text-lg font-semibold" style={heading}>
            Our leadership
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {w.leaders.map((l, i) => (
              <li key={`${l.name}-${i}`} className="flex flex-col items-center gap-2 text-center">
                {l.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL
                  <img src={l.photo.thumbUrl} alt="" className="h-24 w-24 rounded-full object-cover" />
                ) : (
                  <span className="flex h-24 w-24 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground" aria-hidden>
                    {l.name.slice(0, 1)}
                  </span>
                )}
                <span className="font-medium">{l.name}</span>
                <span className="text-sm text-muted-foreground">{l.role}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {w.gallery && w.gallery.photos.length > 0 && (
        <section aria-labelledby="gallery" className="flex flex-col gap-3">
          <h2 id="gallery" className="text-lg font-semibold" style={heading}>
            Gallery
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {w.gallery.photos.map((p) => (
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
          {w.gallery.total > w.gallery.photos.length && (
            <Link href={siteHref(school.code, own, "/gallery")} className="self-start text-sm font-medium text-primary hover:underline">
              All photos
            </Link>
          )}
        </section>
      )}

      {(school.address || school.phone || school.email) && (
        <section aria-labelledby="contact" className="flex flex-col gap-2">
          <h2 id="contact" className="text-lg font-semibold" style={heading}>
            Contact the school
          </h2>
          <dl className="flex flex-col gap-1 text-sm">
            {school.address && (
              <div>
                <dt className="sr-only">Address</dt>
                <dd>{school.address}</dd>
              </div>
            )}
            {school.phone && (
              <div>
                <dt className="sr-only">Phone</dt>
                <dd>
                  <a href={`tel:${school.phone.replace(/\s+/g, "")}`} className="text-primary underline-offset-2 hover:underline">
                    {school.phone}
                  </a>
                </dd>
              </div>
            )}
            {school.email && (
              <div>
                <dt className="sr-only">Email</dt>
                <dd>
                  <a href={`mailto:${school.email}`} className="text-primary underline-offset-2 hover:underline">
                    {school.email}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}
    </SchoolSiteShell>
  );
}
