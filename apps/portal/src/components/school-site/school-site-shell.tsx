import { Caveat } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { LEGAL_URLS, type SchoolPublicDto } from "@school-kit/types";

import { siteHref } from "@/lib/school-site";
import { PORTAL_URL, STAFF_URL } from "@/lib/school-host";

import { ArrowLeft, ArrowRight, ArrowUpRight, Briefcase, ChevronDown, MenuIcon, Smartphone, Users } from "./icons";
import { RevealOnScroll } from "./reveal";
import "./school-site.css";

// The frame of every page on a school's site (docs/modules/school-website.md,
// "The look", 2026-10-25): a header that stays at the top with the ways in,
// the school's own footer, and on phones a bar at the bottom with the one
// thing a family most often comes for. Everything takes the school's accent
// colour (SchoolKit's emerald when it has none).
//
// Sign-in links sit in menus that are closed until opened, and the phone bar
// is hidden on a computer, so each way in appears once on screen at a time.

const caveat = Caveat({ subsets: ["latin"], weight: ["600"], variable: "--font-caveat", display: "swap" });

export interface SiteLinks {
  parents: string;
  staff: string;
  apply: string;
  results: string;
}

/** Where the ways in lead: short paths on the school's own address. */
export function siteLinks(school: SchoolPublicDto, own: boolean): SiteLinks {
  return {
    parents: own ? "/parents/login" : `${PORTAL_URL}/login?school=${encodeURIComponent(school.code)}`,
    staff: own ? "/staff/login" : `${STAFF_URL}/login?school=${encodeURIComponent(school.code)}`,
    apply: own ? "/apply" : `/apply/${school.code}`,
    results: own ? "/results" : `/result-checker/${school.code}`,
  };
}

/** The sections the front page has, so the header only offers real ones. */
function sections(school: SchoolPublicDto): { id: string; label: string }[] {
  const w = school.website;
  return [
    { id: "about", label: "About", show: Boolean(w.about) || w.leaders.length > 0 },
    { id: "news", label: "News", show: w.news !== null && w.news.latest.length > 0 },
    { id: "gallery", label: "Gallery", show: w.gallery !== null && w.gallery.photos.length > 0 },
    { id: "admissions", label: "Admissions", show: school.admissionsOpen || school.resultChecker || Boolean(w.admissionsBox) },
    { id: "contact", label: "Contact", show: Boolean(school.address || school.phone || school.email) },
  ].filter((s) => s.show);
}

export function SchoolLogo({ school, size = 44 }: { school: SchoolPublicDto; size?: number }) {
  return school.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL; next/image would cache it past its life
    <img src={school.logoUrl} alt="" width={size} height={size} className="rounded-xl bg-white object-contain" style={{ width: size, height: size }} />
  ) : (
    <Image src="/brand/schoolkit-icon.png" alt="" width={size} height={size} />
  );
}

function SignInMenu({ links }: { links: SiteLinks }) {
  return (
    <div className="flex flex-col">
      <a href={links.parents} className="ss-menu-item">
        <span className="flex items-center gap-2 font-semibold">
          <Users /> Parents
        </span>
        <span className="text-sm ss-muted">Fees, results, messages and news.</span>
      </a>
      <a href={links.staff} className="ss-menu-item">
        <span className="flex items-center gap-2 font-semibold">
          <Briefcase /> Staff
        </span>
        <span className="text-sm ss-muted">Teachers and the school office.</span>
      </a>
      <div className="ss-menu-item">
        <span className="flex items-center gap-2 font-semibold">
          <Smartphone /> Students
        </span>
        <span className="text-sm ss-muted">Sign in on the SchoolKit app.</span>
      </div>
    </div>
  );
}

export function SchoolSiteShell({
  school,
  own,
  home = false,
  children,
}: {
  school: SchoolPublicDto;
  own: boolean;
  /** The front page: section links scroll within it. */
  home?: boolean;
  children: ReactNode;
}) {
  const accent = school.website.accent;
  const links = siteLinks(school, own);
  const homeHref = siteHref(school.code, own, "");
  const anchor = (id: string) => (home ? `#${id}` : `${homeHref}#${id}`);
  const nav = sections(school);
  const year = new Date().getFullYear();

  return (
    <div
      className={`ss ${caveat.variable} flex min-h-screen flex-col pb-24 md:pb-0`}
      style={accent ? ({ "--sa": accent } as React.CSSProperties) : undefined}
    >
      {school.website.preview && (
        <p className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
          Preview: this is your draft. Families see it after you press Publish.
        </p>
      )}

      <header className="ss-header">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href={homeHref} className="flex min-w-0 items-center gap-3">
            <SchoolLogo school={school} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-base font-extrabold leading-tight tracking-tight sm:text-lg">{school.name}</span>
              {school.motto && <span className="hidden truncate text-xs ss-muted sm:block">{school.motto}</span>}
            </span>
          </Link>

          {nav.length > 0 && (
            <nav aria-label="School site" className="ml-auto hidden items-center gap-7 text-[0.95rem] font-medium lg:flex">
              {nav.map((n) => (
                <a key={n.id} href={anchor(n.id)} className="hover:opacity-70">
                  {n.label}
                </a>
              ))}
            </nav>
          )}

          <div className={`flex shrink-0 items-center gap-2 ${nav.length > 0 ? "lg:ml-6" : ""} ml-auto`}>
            <details className="ss-menu hidden md:block">
              <summary className="ss-btn ss-btn-quiet !py-3">
                Sign in <ChevronDown />
              </summary>
              <div className="ss-menu-panel">
                <SignInMenu links={links} />
              </div>
            </details>
            {school.admissionsOpen && (
              // Wrapped: .ss-btn's own display would beat Tailwind's `hidden`.
              <span className="hidden md:inline-flex">
                <a href={links.apply} className="ss-btn ss-btn-dark !py-3">
                  Apply now <ArrowRight className="ss-arrow" />
                </a>
              </span>
            )}

            {/* Phones: one menu with the sections and the ways in. */}
            <details className="ss-menu md:hidden">
              <summary className="ss-btn ss-btn-quiet !px-3 !py-2.5" aria-label="Menu">
                <MenuIcon />
              </summary>
              <div className="ss-menu-panel w-[min(20rem,calc(100vw-2rem))]">
                {nav.length > 0 && (
                  <div className="flex flex-col border-b border-[#eef1ee] pb-1">
                    {nav.map((n) => (
                      <a key={n.id} href={anchor(n.id)} className="ss-menu-item font-semibold">
                        {n.label}
                      </a>
                    ))}
                  </div>
                )}
                <SignInMenu links={links} />
              </div>
            </details>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 bg-[var(--sa-ink)] text-white">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <SchoolLogo school={school} size={48} />
              <span className="text-lg font-extrabold tracking-tight">{school.name}</span>
            </div>
            {school.motto && <p className="text-white/70">{school.motto}</p>}
            {school.admissionsOpen && (
              <a href={links.apply} className="ss-btn ss-btn-primary self-start">
                Apply for admission <ArrowUpRight />
              </a>
            )}
          </div>
          {nav.length > 0 && (
            <div className="flex flex-col gap-3">
              <span className="text-sm font-bold uppercase tracking-widest text-white/50">Explore</span>
              {nav.map((n) => (
                <a key={n.id} href={anchor(n.id)} className="text-white/85 hover:text-white">
                  {n.label}
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <span className="text-sm font-bold uppercase tracking-widest text-white/50">Get in touch</span>
            {school.phone && (
              <a href={`tel:${school.phone.replace(/\s+/g, "")}`} className="text-white/85 hover:text-white">
                {school.phone}
              </a>
            )}
            {school.email && (
              <a href={`mailto:${school.email}`} className="break-all text-white/85 hover:text-white">
                {school.email}
              </a>
            )}
            {school.address && <span className="text-white/70">{school.address}</span>}
          </div>
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto w-full max-w-6xl px-4 py-5 text-sm text-white/55 sm:px-6">
            © {year} {school.name}
            {" · "}
            {school.website.poweredBy ? "Powered by SchoolKit" : "SchoolKit"}
            {" · "}
            <a href={LEGAL_URLS.privacy} target="_blank" rel="noreferrer" className="hover:text-white">
              Privacy
            </a>
          </p>
        </div>
      </footer>

      {/* Phones: the one thing most families come for, always to hand. */}
      <div className="ss-phone-bar md:hidden">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          {school.admissionsOpen ? (
            <>
              <span className="ss-badge">Admissions open</span>
              <a href={links.apply} className="ss-btn ss-btn-primary !py-3">
                Apply now <ArrowUpRight />
              </a>
            </>
          ) : (
            <>
              <span className="min-w-0 truncate text-sm font-semibold">{school.name}</span>
              <a href={anchor("sign-in")} className="ss-btn ss-btn-primary !py-3">
                Sign in <ArrowRight />
              </a>
            </>
          )}
        </div>
      </div>

      <RevealOnScroll />
    </div>
  );
}

/** The top of a page after the front one: back to the school, then its title. */
export function SubPageHead({ id, eyebrow, title, back }: { id: string; eyebrow: string; title: string; back: { href: string; label: string } }) {
  return (
    <div className="mb-10 flex flex-col gap-5">
      <Link href={back.href} className="ss-btn-text self-start text-sm" style={{ color: "var(--sa)" }}>
        <ArrowLeft className="ss-arrow" /> {back.label}
      </Link>
      <span className="ss-eyebrow self-start">
        <span className="ss-eyebrow-dot" />
        {eyebrow}
      </span>
      <h1 id={id} className="ss-display ss-display-sm">
        {title}
      </h1>
    </div>
  );
}
