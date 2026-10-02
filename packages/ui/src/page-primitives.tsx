import type { ReactNode } from "react";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// The website's layout vocabulary (docs/modules/look-and-feel.md Part 1).
//
// SHARED (look-and-feel.md D4, 2026-10-02): this file moved here from
// apps/web/src/components/layout/page-primitives.tsx so apps/portal speaks the
// same vocabulary instead of a copy of it. A copy is how two surfaces drift —
// which is the exact problem D1 exists to stop, one level up. apps/web's old
// path re-exports from here, so its importers did not change.
//
// Both apps list this package in `transpilePackages` and in their Tailwind
// `content`, which is what lets the class names below reach either stylesheet.
//
// WHY THIS FILE EXISTS. The brand tokens reached 63 of 88 admin and teacher
// pages, and the site still read as a draft — because colour was never the
// problem. `apps/mobile` got a design pass in CP8 that produced eight
// primitives every screen composes from; the web got none, so 59 pages
// hand-rolled their own header with inline classes and invented their own
// spacing, density and empty states as they went.
//
// D1: the primitives come FIRST and are applied second. Fixing the
// worst-looking page first produces 88 individually-improved pages that still
// do not agree with each other — which is exactly the state these pages are
// already in, arrived at one page at a time.
//
// D2: this matches the app's LANGUAGE, not its layout. A phone is one column,
// thumb-first, one job per screen; a desktop page is dense and does several
// things at once. Copying the app's tile grids to a 1400px screen would produce
// a stretched phone, which is its own kind of amateurish. What transfers is the
// type scale, the card treatment, the emerald-for-primary discipline, and the
// rule that an empty state says what to do next.

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The page's title block. Replaces 59 hand-rolled headers.
 *
 * `actions` is a slot rather than a prop list because what belongs there varies
 * enormously — one button on Settings, a dropdown plus export plus print on
 * Students — and a prop per case would end up describing every page's toolbar
 * in this file.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {/* Wraps below the title on a phone rather than squeezing beside it: a
          head teacher opening this on their handset should not meet a row of
          half-width buttons. */}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A section inside a page. Today these are ad-hoc `h2`s with varying weights. */
export function SectionHeader({
  title,
  note,
  actions,
}: {
  title: string;
  note?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-medium text-foreground">{title}</h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {actions ?? null}
    </div>
  );
}

/**
 * What a page shows when there is nothing.
 *
 * `action` is encouraged rather than optional-by-habit: an empty state that
 * only says "no students yet" leaves someone looking for the button. The app
 * has followed this rule since CP8 and the web has not.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/30 p-8 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="font-medium text-foreground">{title}</p>
      <p className="max-w-prose text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * A loading placeholder that holds the SHAPE of what is coming.
 *
 * Most pages currently render the word "Loading…", which tells the reader to
 * wait without telling them what for, and lets the layout jump when content
 * lands. D5: a page should resolve rather than snap.
 */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-12 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
          // The last row is shorter, so a block of identical bars reads as a
          // list rather than as a broken page.
          style={index === rows - 1 ? { width: "60%" } : undefined}
        />
      ))}
    </div>
  );
}

/**
 * Content arriving where a skeleton was (Part 2, D5 — the first of the three
 * motion uses the plan allows).
 *
 * 180ms, a fade plus a 2px rise, and that is the whole effect. It exists so a
 * page RESOLVES instead of snapping: the skeleton has been holding roughly
 * this shape, and without the fade the swap reads as a flicker even when it is
 * fast. Anything longer starts to feel like an animation the reader is waiting
 * through rather than a response.
 *
 * `motion-reduce:animate-none` is not decoration on this component — D6 says
 * every transition here is disabled by that query and means it. A school of
 * 400 has several people for whom movement is nausea, and this is one media
 * query.
 *
 * Deliberately NOT applied to list ITEMS. A staggered list entrance is the
 * exact thing D5 rules out: an admin who opens this roster forty times a day
 * would watch the same 300ms of choreography forty times.
 */
export function Appear({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** An inline "working…" for buttons and toolbars, so each page stops writing its own. */
export function Working({ label = "Loading…" }: { label?: string }) {
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      {/* lucide's Loader2, inlined: the portal has no icon library, and one
          spinner is not a reason to give it one. */}
      <svg
        className="h-4 w-4 animate-spin motion-reduce:animate-none"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      {label}
    </span>
  );
}

/**
 * One figure and what it means.
 *
 * Deliberately NOT the dashboard's bespoke KPI markup generalised: that one
 * carries progress meters and a serif numeral at display size, which is right
 * for a landing screen and too loud repeated eight times on a report.
 */
export function StatRow({
  value,
  label,
  tone = "default",
  href,
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: "default" | "warning";
  href?: string;
}) {
  const body = (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border bg-card p-4 transition-colors motion-reduce:transition-none",
        href ? "hover:border-primary/60" : "",
      )}
    >
      {/* Warning is carried by the figure's colour, not an accent edge — the
          project does not use them (2026-10-02). amber-700 rather than the
          brand's Gold Spark: on Paper, gold text is 2.0:1 and amber-700 is
          4.6:1 (AA). */}
      <span
        className={cn(
          "font-serif text-2xl font-medium",
          tone === "warning" ? "text-amber-700" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
  return href ? (
    <a href={href} className="block">
      {body}
    </a>
  ) : (
    body
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

/**
 * Search, filters and a count, aligned — a web need the phone does not have.
 *
 * `count` sits here rather than above the table because "12 of 340" answers a
 * question the filters just raised, and a page that puts it elsewhere makes
 * people look twice.
 */
export function FilterBar({
  children,
  count,
}: {
  children: ReactNode;
  count?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">{children}</div>
      {count ? <p className="text-sm text-muted-foreground">{count}</p> : null}
    </div>
  );
}

/** Label, control, hint and error — currently inline on every form on the site. */
export function FormRow({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1 text-sm", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && !error ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/**
 * The shell a data table sits in: one border, one scroll container, one set of
 * states.
 *
 * Takes `loading` and `empty` rather than leaving each page to branch, because
 * that branch is exactly what every page currently gets slightly differently —
 * some show "Loading…", some show nothing, some show a table with no rows.
 */
export function DataTableShell({
  loading,
  empty,
  children,
  caption,
}: {
  loading?: boolean;
  /** Rendered instead of the table when there is no data. */
  empty?: ReactNode;
  children: ReactNode;
  caption?: string;
}) {
  if (loading) return <PageSkeleton rows={5} />;
  if (empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-sm" {...(caption ? { "aria-label": caption } : {})}>
        {children}
      </table>
    </div>
  );
}
