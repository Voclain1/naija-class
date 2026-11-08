"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { TermDto } from "@school-kit/types";

import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { NAVIGATION_INTENT_EVENT, intentPathname } from "@/lib/navigation-intent";
import { stripBasePath } from "@/lib/base-path";

import { type TermResolution, defaultParamToWrite } from "./term-default";

// Lives in the topbar (per the mockup) and means something on the routes in
// TERM_AWARE_ROUTES below — the selected term is carried in the URL
// (?termId=) rather than a new global "current term" context, so those pages
// and this selector share one source of truth without inventing app-wide term
// state ahead of need. Renders nothing on any other route.
//
// Phase 5 / Slice 8 added /insights as the second such route. That is why the
// redirects below target `pathname` rather than a hardcoded "/dashboard":
// keeping the literal would have bounced an admin off /insights to the
// dashboard the moment they changed term, which reads as the app losing their
// place.
const TERM_AWARE_ROUTES = ["/dashboard", "/insights"];

// The DEFAULT term (and the no-academic-year signal) is written into the URL
// after two fetches resolve, by which time the person may already have clicked
// away. That write is a router.replace(), and a replace issued while their
// click is still navigating cancels it and puts them back on /dashboard
// (docs/deferred-archive.md, "navigation race on /dashboard").
//
// So the automatic write is skipped once the person has started to leave: a
// click on a link to another page of the app, a navigation announced from code
// (the command palette, via lib/navigation-intent), or Back/Forward. It is also
// skipped if the browser is no longer on the page that started the fetches. A
// term the person CHOOSES from the select still navigates normally.
//
// Not history.replaceState: Next syncs a plain replaceState into the router
// (with the `__NA` state it is ignored and the page never sees the term), and
// that sync cancels an in-flight navigation exactly as router.replace does.
function isLeavingClick(event: MouseEvent, currentPath: string): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || (anchor.target && anchor.target !== "_self")) return false;
  const url = new URL(anchor.href, window.location.href);
  // The browser's path carries the base path (/staff); usePathname's does not.
  return url.origin === window.location.origin && stripBasePath(url.pathname) !== currentPath;
}

export function DashboardTermSelector() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [terms, setTerms] = useState<TermDto[]>([]);
  const [resolution, setResolution] = useState<TermResolution | null>(null);

  const isTermAware = TERM_AWARE_ROUTES.includes(pathname);
  const termId = searchParams.get("termId") ?? "";
  // The term-aware page the fetches below started on, and whether the person
  // has since started to leave it.
  const startedOn = useRef(pathname);
  const leaving = useRef(false);

  useEffect(() => {
    if (!isTermAware) return;
    leaving.current = false;
    const onClick = (event: MouseEvent) => {
      if (isLeavingClick(event, pathname)) leaving.current = true;
    };
    const onPopState = () => {
      leaving.current = true;
    };
    // A router.push() from code, announced by its caller (the command palette).
    const onIntent = (event: Event) => {
      const target = intentPathname(event);
      if (target !== null && target !== pathname) leaving.current = true;
    };
    // Capture phase: runs before next/link's own click handler starts the navigation.
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    window.addEventListener(NAVIGATION_INTENT_EVENT, onIntent);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener(NAVIGATION_INTENT_EVENT, onIntent);
      leaving.current = true;
    };
  }, [isTermAware, pathname]);

  function writeDefaultParam(key: string, value: string) {
    if (leaving.current || stripBasePath(window.location.pathname) !== startedOn.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get(key) === value) return;
    params.set(key, value);
    router.replace(`${startedOn.current}?${params.toString()}`);
  }

  // Resolved once per VISIT to a term-aware page, not once per mount. This
  // component lives in the topbar, which stays mounted while the person moves
  // around the app, so "fetch on mount" meant: open /dashboard (term written),
  // go to /students, come back to /dashboard (no ?termId= on the sidebar's
  // link) — and nothing ran again. The year lookup did re-run, but it set the
  // SAME yearId, so the terms effect keyed on it never fired, no default term
  // was written, and the dashboard waited on its loading spinner forever
  // (owner report, 2026-11-08). The same happened on /dashboard -> /insights,
  // and on clicking "Dashboard" while already on /dashboard?termId=….
  //
  // `resolution` is cleared at the start of each visit so a stale answer from
  // an earlier one (no academic year then, one set up since) is never written.
  useEffect(() => {
    if (!isTermAware) return;
    startedOn.current = pathname;
    setResolution(null);
    let current = true;
    listAcademicYears()
      .then(async (rows) => {
        const year = rows.find((y) => y.isCurrent) ?? rows[0];
        if (!year) {
          // A brand-new school (just finished onboarding) has no academic
          // year yet — nothing for this selector to ever resolve into a
          // termId. Without this signal the dashboard page has no way to
          // distinguish "still fetching" from "genuinely nothing to show"
          // and is stuck on its loading state forever (found via the real
          // e2e happy-path run, 2026-07-26 — a fresh signup never has a
          // term, so this is the FIRST thing every new school's dashboard
          // hits, not an edge case).
          if (current) setResolution({ noAcademicYear: true, defaultTermId: null });
          return;
        }
        const termRows = await listTerms(year.id).catch(() => [] as TermDto[]);
        if (!current) return;
        setTerms(termRows);
        const term = termRows.find((t) => t.isCurrent) ?? termRows[0];
        setResolution({ noAcademicYear: false, defaultTermId: term?.id ?? null });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [isTermAware, pathname]);

  // Writes the default whenever the URL is missing one — after the fetch
  // above settles, and again if the URL loses it later on the same page.
  const noAcademicYearParam = searchParams.get("noAcademicYear") === "1";
  useEffect(() => {
    if (!isTermAware) return;
    const write = defaultParamToWrite(resolution, termId, noAcademicYearParam);
    if (write) writeDefaultParam(write.key, write.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTermAware, pathname, resolution, termId, noAcademicYearParam]);

  function setTermForUrl(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("termId", id);
    router.replace(`${pathname}?${params.toString()}`);
  }

  if (!isTermAware || terms.length === 0) return null;

  return (
    <select
      value={termId}
      onChange={(e) => setTermForUrl(e.target.value)}
      className="h-9 max-w-[5.5rem] rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-none sm:px-3 sm:text-sm"
      aria-label="Select term"
    >
      {terms.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
