import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import type { SchoolPublicDto } from "@school-kit/types";

import { SchoolIllustration } from "@/components/school-site/illustration";
import { ArrowRight, ArrowUpRight, Briefcase, Check, Mail, MapPin, Phone, Quote, Smartphone, Squiggle, Users } from "@/components/school-site/icons";
import { ReportButton } from "@/components/school-site/report-button";
import { SchoolSiteShell, siteLinks } from "@/components/school-site/school-site-shell";
import { formatDateRange, formatPublished, loadSchool, onSchoolAddress, siteHref } from "@/lib/school-site";
import { schoolAddressUrl } from "@/lib/school-host";

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
// The look ("The look", 2026-10-25): the school's name large in the hero with
// its motto under a marker-pen swipe, the cover photo on a tilted card, and
// each section after it on a wide page in the school's accent colour.
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

const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-6";

/** "Year founded: 1998" reads better in the hero as "Since 1998". */
function tickLine(f: { label: string; value: string }): string {
  if (/founded|established/i.test(f.label) && /^\d{4}$/.test(f.value.trim())) return `Since ${f.value.trim()}`;
  return `${f.label}: ${f.value}`;
}

function dateParts(iso: string): { day: string; month: string } {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return {
    day: d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "Africa/Lagos" }),
    month: d.toLocaleDateString("en-GB", { month: "short", timeZone: "Africa/Lagos" }),
  };
}

function SectionHead({ id, eyebrow, title, action }: { id: string; eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-3">
        <span className="ss-eyebrow self-start">
          <span className="ss-eyebrow-dot" />
          {eyebrow}
        </span>
        <h2 id={id} className="ss-h2">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="ss-btn-text" style={{ color: "var(--sa)" }}>
      {children} <ArrowRight className="ss-arrow" />
    </Link>
  );
}

function Hero({ school, own }: { school: SchoolPublicDto; own: boolean }) {
  const w = school.website;
  const links = siteLinks(school, own);
  const levels = w.facts.find((f) => /level|class|section/i.test(f.label));
  const eyebrow = school.admissionsOpen ? "Admissions open" : (levels?.value ?? "Welcome");
  const ticks = w.facts.slice(0, 3);
  const photo = w.cover?.photo;

  return (
    <section aria-label="Welcome" className="ss-hero">
      <div className={`${CONTAINER} grid items-center gap-12 pb-16 pt-10 sm:pt-14 lg:grid-cols-[1.1fr_1fr] lg:gap-10 lg:pb-24 lg:pt-20`}>
        <div className="flex flex-col gap-6">
          <span className="ss-eyebrow ss-rise self-start">
            <span className="ss-eyebrow-dot" />
            {eyebrow}
          </span>
          <h1 className="ss-display ss-rise ss-rise-2">{school.name}</h1>
          {school.motto && (
            <p className="ss-rise ss-rise-2 text-2xl font-bold tracking-tight sm:text-3xl">
              <span className="ss-marker">{school.motto}</span>
            </p>
          )}
          {w.cover?.welcome && <p className="ss-lead ss-rise ss-rise-3 max-w-xl">{w.cover.welcome}</p>}
          {ticks.length > 0 && (
            <ul className="ss-rise ss-rise-3 flex flex-wrap gap-x-6 gap-y-2">
              {ticks.map((f) => (
                <li key={f.label} className="ss-tick">
                  <Check /> {tickLine(f)}
                </li>
              ))}
            </ul>
          )}
          <div className="ss-rise ss-rise-4 flex flex-wrap items-center gap-3 pt-2">
            {school.admissionsOpen && (
              <a href={links.apply} className="ss-btn ss-btn-primary">
                Apply for admission <ArrowUpRight />
              </a>
            )}
            {school.resultChecker && (
              <a href={links.results} className="ss-btn ss-btn-quiet">
                Check results
              </a>
            )}
            <a href="#sign-in" className="ss-btn-text px-2">
              Sign in <ArrowRight className="ss-arrow" />
            </a>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
          <div className="ss-blob" aria-hidden />
          <div className="ss-ring" aria-hidden />
          <div className="relative px-6 pb-16 pt-8 sm:px-10">
            <div className="ss-cover-card ss-rise ss-rise-2">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL
                <img src={photo.largeUrl} alt={photo.caption ?? ""} className="aspect-[4/3] w-full rounded-[1rem] object-cover" />
              ) : (
                <SchoolIllustration className="aspect-[4/3] w-full rounded-[1rem]" />
              )}
            </div>
            <div className="absolute bottom-0 left-2 flex items-end gap-1 sm:left-6" aria-hidden>
              <span className="ss-script -rotate-3">Welcome to our school</span>
              <Squiggle className="-mb-1 hidden h-10 w-24 -rotate-12 sm:block" style={{ color: "var(--sa)" }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SignIn({ school, own }: { school: SchoolPublicDto; own: boolean }) {
  const links = siteLinks(school, own);
  const card = "ss-card flex flex-col gap-4 p-6";
  const icon = "flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sa-tint)] text-[var(--sa)]";
  return (
    <section aria-labelledby="sign-in" className={`${CONTAINER} scroll-mt-24 py-12`} data-ss-reveal>
      <SectionHead id="sign-in" eyebrow="For our school community" title="Sign in" />
      <div className="grid gap-4 md:grid-cols-3">
        <a href={links.parents} className={card}>
          <span className={icon}>
            <Users />
          </span>
          <span className="flex items-center justify-between gap-2 text-xl font-bold">
            Parents <ArrowUpRight className="text-[var(--sa)]" />
          </span>
          <span className="ss-muted">Fees, results, messages and news.</span>
        </a>
        <div className={card}>
          <span className={icon}>
            <Smartphone />
          </span>
          <span className="text-xl font-bold">Students</span>
          <span className="ss-muted">
            Sign in on the SchoolKit app with school code <strong className="text-[var(--sa-ink)]">{school.code}</strong>.
          </span>
        </div>
        <a href={links.staff} className={card}>
          <span className={icon}>
            <Briefcase />
          </span>
          <span className="flex items-center justify-between gap-2 text-xl font-bold">
            Staff <ArrowUpRight className="text-[var(--sa)]" />
          </span>
          <span className="ss-muted">Teachers and the school office.</span>
        </a>
      </div>
    </section>
  );
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
  const links = siteLinks(school, own);
  const w = school.website;
  const hasAdmissions = school.admissionsOpen || school.resultChecker || Boolean(w.admissionsBox);
  const hasContact = Boolean(school.address || school.phone || school.email);
  // The mosaic is one large photo and rows of four: 5 or 9 fill it evenly.
  const photos = w.gallery?.photos ?? [];
  const shownPhotos = photos.length >= 9 ? photos.slice(0, 9) : photos.length >= 5 ? photos.slice(0, 5) : photos;

  return (
    <SchoolSiteShell school={school} own={own} home>
      <Hero school={school} own={own} />

      {w.facts.length > 0 && (
        <section aria-labelledby="facts" className={CONTAINER} data-ss-reveal>
          <h2 id="facts" className="sr-only">
            Quick facts
          </h2>
          <dl className="ss-panel-strong grid grid-cols-2 gap-x-6 gap-y-8 px-6 py-10 sm:px-10 md:grid-cols-4">
            {w.facts.map((f) => (
              <div key={f.label} className="flex flex-col gap-1">
                <dt className="text-sm font-semibold uppercase tracking-wider text-white/70">{f.label}</dt>
                <dd className="text-2xl font-extrabold tracking-tight sm:text-3xl">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <SignIn school={school} own={own} />

      {(w.announcements.length > 0 || w.events.length > 0) && (
        <div className={`${CONTAINER} grid gap-12 py-12 lg:grid-cols-2`}>
          {w.announcements.length > 0 && (
            <section aria-labelledby="announcements" data-ss-reveal>
              <SectionHead id="announcements" eyebrow="Notice board" title="Announcements" />
              <ul className="flex flex-col gap-4">
                {w.announcements.map((a) => (
                  <li key={a.id} className="ss-card flex flex-col gap-2 p-6">
                    <span className="text-sm font-semibold text-[var(--sa)]">{formatPublished(a.date)}</span>
                    <p className="text-lg font-bold">{a.title}</p>
                    <p className="ss-muted whitespace-pre-line">{a.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {w.events.length > 0 && (
            <section aria-labelledby="events" data-ss-reveal>
              <SectionHead id="events" eyebrow="Calendar" title="Coming up" />
              <ul className="flex flex-col gap-4">
                {w.events.map((e) => {
                  const d = dateParts(e.startDate);
                  return (
                    <li key={e.id} className="ss-card flex items-center gap-5 p-4 sm:p-5">
                      <span className="ss-date" aria-hidden>
                        <span className="text-2xl font-extrabold">{d.day}</span>
                        <span className="mt-1 text-xs font-bold uppercase tracking-wider">{d.month}</span>
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-lg font-bold leading-snug">{e.title}</span>
                        <span className="text-sm ss-muted">{formatDateRange(e.startDate, e.endDate)}</span>
                        {e.description && <span className="text-sm ss-muted">{e.description}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      {w.news && w.news.latest.length > 0 && (
        <section aria-labelledby="news" className={`${CONTAINER} scroll-mt-24 py-12`} data-ss-reveal>
          <SectionHead
            id="news"
            eyebrow="From the school"
            title="News"
            action={w.news.total > w.news.latest.length ? <MoreLink href={siteHref(school.code, own, "/news")}>All news</MoreLink> : undefined}
          />
          <ul className="grid gap-6 md:grid-cols-3">
            {w.news.latest.map((p) => (
              <li key={p.id}>
                <Link href={siteHref(school.code, own, `/news/${p.id}`)} className="ss-card ss-img-zoom flex h-full flex-col">
                  {p.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL
                    <img src={p.photo.thumbUrl} alt={p.photo.caption ?? ""} className="aspect-[16/10] w-full rounded-t-[1.4rem] object-cover" />
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
        </section>
      )}

      {(w.about || w.leaders.length > 0) && (
        <section aria-labelledby="about" className={`${CONTAINER} scroll-mt-24 py-12`} data-ss-reveal>
          <SectionHead id="about" eyebrow="Who we are" title="About us" />
          {w.about && (
            <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
              {w.about.headWelcome ? (
                <figure className="ss-panel flex flex-col gap-5 p-8 sm:p-10">
                  <Quote className="text-[var(--sa)]" />
                  <blockquote className="whitespace-pre-line text-xl font-semibold leading-relaxed tracking-tight sm:text-2xl">
                    {w.about.headWelcome}
                  </blockquote>
                  {(w.about.headName || w.about.headTitle) && (
                    <figcaption className="flex flex-col">
                      {w.about.headName && <span className="font-bold">{w.about.headName}</span>}
                      {w.about.headTitle && <span className="text-sm ss-muted">{w.about.headTitle}</span>}
                    </figcaption>
                  )}
                </figure>
              ) : null}
              {w.about.story && <p className={`ss-lead whitespace-pre-line ${w.about.headWelcome ? "" : "lg:col-span-2 max-w-3xl"}`}>{w.about.story}</p>}
            </div>
          )}

          {w.leaders.length > 0 && (
            <div className={w.about ? "mt-16" : ""}>
              <h3 id="leaders" className="mb-8 text-2xl font-extrabold tracking-tight">
                Our leadership
              </h3>
              <ul className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-4">
                {w.leaders.map((l, i) => (
                  <li key={`${l.name}-${i}`} className="flex flex-col items-center gap-3 text-center">
                    <span className="rounded-full bg-[var(--sa-tint)] p-1.5">
                      {l.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL
                        <img src={l.photo.thumbUrl} alt="" className="h-32 w-32 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-32 w-32 items-center justify-center rounded-full bg-white text-3xl font-extrabold text-[var(--sa)]" aria-hidden>
                          {l.name.slice(0, 1)}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-lg font-bold">{l.name}</span>
                      <span className="text-sm ss-muted">{l.role}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {w.gallery && w.gallery.photos.length > 0 && (
        <section aria-labelledby="gallery" className={`${CONTAINER} scroll-mt-24 py-12`} data-ss-reveal>
          <SectionHead
            id="gallery"
            eyebrow="Life at school"
            title="Gallery"
            action={w.gallery.total > shownPhotos.length ? <MoreLink href={siteHref(school.code, own, "/gallery")}>All photos</MoreLink> : undefined}
          />
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {shownPhotos.map((p, i) => (
              <li key={p.id} className={`flex flex-col gap-2 ${i === 0 ? "col-span-2 row-span-2" : ""}`}>
                <a href={p.largeUrl} target="_blank" rel="noreferrer" className="ss-img-zoom block flex-1 rounded-[1.2rem]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL */}
                  <img src={p.thumbUrl} alt={p.caption ?? ""} className={`h-full w-full rounded-[1.2rem] object-cover ${i === 0 ? "aspect-square" : "aspect-[4/3]"}`} />
                </a>
                <span className="flex items-start justify-between gap-2">
                  <span className="text-sm ss-muted">{p.caption}</span>
                  <ReportButton code={school.code} target={{ photoId: p.id }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasAdmissions && (
        <section aria-labelledby="admissions" className={`${CONTAINER} scroll-mt-24 py-12`} data-ss-reveal>
          <div className="ss-panel grid gap-10 p-8 sm:p-12 lg:grid-cols-[1.2fr_1fr]">
            <div className="flex flex-col gap-5">
              <span className="ss-eyebrow self-start" style={{ background: "#fff" }}>
                <span className="ss-eyebrow-dot" />
                {school.admissionsOpen ? "Admissions open" : "For families"}
              </span>
              <h2 id="admissions" className="ss-h2">
                {school.admissionsOpen ? "Join our school" : "Admissions and results"}
              </h2>
              {w.admissionsBox?.visitNote && <p className="ss-lead whitespace-pre-line">{w.admissionsBox.visitNote}</p>}
              <div className="flex flex-wrap gap-3 pt-1">
                {school.admissionsOpen && (
                  <a href={links.apply} className="ss-btn ss-btn-primary">
                    Apply for admission <ArrowUpRight />
                  </a>
                )}
                {school.resultChecker && (
                  <a href={links.results} className="ss-btn ss-btn-quiet">
                    Check results with a PIN
                  </a>
                )}
              </div>
            </div>
            {w.admissionsBox && (w.admissionsBox.entryClasses.length > 0 || w.admissionsBox.feesText) && (
              <div className="flex flex-col gap-6 rounded-[1.2rem] bg-white p-6 sm:p-8">
                {w.admissionsBox.entryClasses.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <span className="text-sm font-bold uppercase tracking-wider ss-muted">Entry classes</span>
                    <ul className="flex flex-wrap gap-2">
                      {w.admissionsBox.entryClasses.map((c) => (
                        <li key={c} className="ss-chip" style={{ background: "var(--sa-tint)", color: "var(--sa)" }}>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {w.admissionsBox.feesText && (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-bold uppercase tracking-wider ss-muted">Fees</span>
                    <p className="whitespace-pre-line">{w.admissionsBox.feesText}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {hasContact && (
        <section aria-labelledby="contact" className={`${CONTAINER} scroll-mt-24 py-12`} data-ss-reveal>
          <SectionHead id="contact" eyebrow="Visit or call" title="Contact the school" />
          <div className="grid gap-4 md:grid-cols-3">
            {school.phone && (
              <a href={`tel:${school.phone.replace(/\s+/g, "")}`} className="ss-card flex flex-col gap-3 p-6">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sa-tint)] text-[var(--sa)]">
                  <Phone />
                </span>
                <span className="text-sm font-bold uppercase tracking-wider ss-muted">Call</span>
                <span className="text-lg font-bold">{school.phone}</span>
              </a>
            )}
            {school.email && (
              <a href={`mailto:${school.email}`} className="ss-card flex flex-col gap-3 p-6">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sa-tint)] text-[var(--sa)]">
                  <Mail />
                </span>
                <span className="text-sm font-bold uppercase tracking-wider ss-muted">Email</span>
                <span className="break-all text-lg font-bold">{school.email}</span>
              </a>
            )}
            {school.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${school.name}, ${school.address}`)}`}
                target="_blank"
                rel="noreferrer"
                className="ss-card flex flex-col gap-3 p-6"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sa-tint)] text-[var(--sa)]">
                  <MapPin />
                </span>
                <span className="text-sm font-bold uppercase tracking-wider ss-muted">Get directions</span>
                <span className="text-lg font-bold">{school.address}</span>
              </a>
            )}
          </div>
        </section>
      )}
    </SchoolSiteShell>
  );
}
