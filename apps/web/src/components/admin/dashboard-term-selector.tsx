"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { TermDto } from "@school-kit/types";

import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";

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

export function DashboardTermSelector() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [terms, setTerms] = useState<TermDto[]>([]);
  const [yearId, setYearId] = useState("");

  const isTermAware = TERM_AWARE_ROUTES.includes(pathname);
  const termId = searchParams.get("termId") ?? "";

  useEffect(() => {
    if (!isTermAware) return;
    listAcademicYears()
      .then((rows) => {
        const current = rows.find((y) => y.isCurrent) ?? rows[0];
        if (current) {
          setYearId(current.id);
        } else {
          // A brand-new school (just finished onboarding) has no academic
          // year yet — nothing for this selector to ever resolve into a
          // termId. Without this signal the dashboard page has no way to
          // distinguish "still fetching" from "genuinely nothing to show"
          // and is stuck on its loading state forever (found via the real
          // e2e happy-path run, 2026-07-26 — a fresh signup never has a
          // term, so this is the FIRST thing every new school's dashboard
          // hits, not an edge case).
          const params = new URLSearchParams(searchParams.toString());
          params.set("noAcademicYear", "1");
          router.replace(`${pathname}?${params.toString()}`);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTermAware]);

  useEffect(() => {
    if (!yearId) return;
    listTerms(yearId)
      .then((rows) => {
        setTerms(rows);
        if (!termId) {
          const current = rows.find((t) => t.isCurrent) ?? rows[0];
          if (current) setTermForUrl(current.id);
        }
      })
      .catch(() => setTerms([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearId]);

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
