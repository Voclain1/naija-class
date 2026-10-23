import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import type { SchoolPublicDto } from "@school-kit/types";

import { siteHref } from "@/lib/school-site";

// The frame of every page on a school's site: its logo (SchoolKit's when it
// has none), name and motto, the school's own accent colour on Professional,
// and one line of footer.
export function SchoolSiteShell({
  school,
  own,
  home = false,
  children,
}: {
  school: SchoolPublicDto;
  own: boolean;
  /** The front page, where the school's name is the page's main heading. */
  home?: boolean;
  children: ReactNode;
}) {
  const accent = school.website.accent;
  const Name = home ? "h1" : "span";
  const nav = [
    { href: siteHref(school.code, own, ""), label: "Home", show: true },
    { href: siteHref(school.code, own, "/news"), label: "News", show: school.website.news !== null && school.website.news.total > 0 },
    { href: siteHref(school.code, own, "/gallery"), label: "Gallery", show: school.website.gallery !== null && school.website.gallery.total > 0 },
  ].filter((n) => n.show);

  return (
    <div className="flex min-h-screen flex-col" style={accent ? ({ "--site-accent": accent } as React.CSSProperties) : undefined}>
      {school.website.preview && (
        <p className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
          Preview: this is your draft. Families see it after you press Publish.
        </p>
      )}
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-3 px-4 py-4">
          <Link href={siteHref(school.code, own, "")} className="flex items-center gap-3">
            {school.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL; next/image would cache it past its life
              <img src={school.logoUrl} alt="" className="h-12 w-12 rounded-md object-contain" />
            ) : (
              <Image src="/brand/schoolkit-icon.png" alt="" width={48} height={48} />
            )}
            <span className="flex flex-col">
              <Name className="text-xl font-semibold leading-tight text-foreground" style={accent ? { color: accent } : undefined}>
                {school.name}
              </Name>
              {school.motto && <span className="text-sm text-muted-foreground">{school.motto}</span>}
            </span>
          </Link>
          {nav.length > 1 && (
            <nav aria-label="School site" className="ml-auto flex gap-4 text-sm">
              {nav.map((n) => (
                <Link key={n.label} href={n.href} className="font-medium text-foreground hover:underline">
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-4 py-8">{children}</main>

      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        {school.website.poweredBy ? <>Powered by SchoolKit</> : <>© {new Date().getFullYear()} SchoolKit</>}
      </footer>
    </div>
  );
}

/** A button-styled link in the school's accent, or the portal's primary. */
export function AccentLink({ href, accent, children }: { href: string; accent: string | null; children: ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      style={accent ? { background: accent, color: "#ffffff" } : undefined}
    >
      {children}
    </a>
  );
}
