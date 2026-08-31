"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AcademicYearDto, FinanceDashboardDto, TermDto } from "@school-kit/types";

import { BrandLoadingInline } from "@/components/brand-loading-screen";
import { InlineAlert } from "@/components/shared/inline-alert";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { useAuth } from "@/lib/auth/use-auth";
import { getFinanceDashboard } from "@/lib/finance/finance-api";
import { financeErrorMessage, logFinanceError } from "@/lib/finance/error-copy";
import { formatKobo } from "@/lib/finance/format";

// /finance/dashboard — Phase 3 / Slice 14. Read-only aggregation, all
// numbers server-computed (CLAUDE.md: never compute money in the frontend).
//
// Term selector is the exact same year/term pattern as /finance/debtors —
// termId is a required query param server-side (no "current term" default),
// so the client resolves it the same way debtors already does.
//
// Stat tiles + one meter (dataviz skill: "a handful of headline numbers" is
// a KPI row, "a single ratio against a limit" is a meter — not a chart).
// Net position is the one genuine polarity signal here (above/below zero),
// so it's the one value that carries status color; everything else is a
// plain descriptive number in text tokens.

// Local copy of sidebar.tsx's helper (it isn't exported there either). Kept
// local rather than lifted to a shared module because that would be a
// cross-cutting refactor riding along on a bursar bugfix; if a third caller
// appears, extract it then.
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

// Why this exists (2026-08-21): `bursar`'s home route is THIS page
// (home-route.ts), and the page only renders once a term is selected. Both
// selectors default off `isCurrent` — a MANUALLY set flag, never derived from
// dates, set only by POST /academic-years/:id/set-current and
// POST /terms/:id/set-current. When nothing is flagged current, the page fell
// back to "Select an academic year and term", which for a bursar is a dead
// end: PHASE_3_BURSAR_PERMISSIONS holds no academic-year.create,
// academic-year.update or term.update, so they can neither create a year nor
// mark one current, and nothing on screen said so or named who could.
//
// This deliberately does NOT resolve a term by date as a fallback.
// `isCurrent` is the codebase-wide definition of "current" (enrollments,
// student roster, teacher-scope all key off it); date-resolving here alone
// would let the finance dashboard report one term while the roster is in
// another — invoices attributed to a different term than the enrollments
// they belong to. An honest empty state beats a silent divergence.
//
// The zero-years case is the visible symptom of a known, deliberately-open
// root cause: every newly provisioned school lands with no academic year and
// no term through both onboarding paths (docs/deferred.md, #198). This names
// the situation; it does not paper over it.
function AcademicSetupNotice({ message, canFix }: { message: string; canFix: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
      <p className="font-medium text-foreground">{message}</p>
      {canFix ? (
        <p className="mt-1 text-muted-foreground">
          Set one up in{" "}
          <Link href="/settings/academic" className="font-medium text-primary underline underline-offset-2">
            Settings → Academic
          </Link>
          .
        </p>
      ) : (
        <p className="mt-1 text-muted-foreground">
          Ask your school administrator to set this up in Settings → Academic. Finance figures stay
          empty until a current term is set.
        </p>
      )}
    </div>
  );
}

export default function FinanceDashboardPage() {
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [yearId, setYearId] = useState("");
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");

  const [dashboard, setDashboard] = useState<FinanceDashboardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolved separately from `years.length` so the notice below can tell
  // "the school has no academic year" apart from "the fetch hasn't landed
  // yet" — both are an empty array, and only one of them is worth alarming
  // a bursar about.
  const [yearsLoaded, setYearsLoaded] = useState(false);
  const [termsLoaded, setTermsLoaded] = useState(false);
  // A FAILED academic-years fetch also leaves `years` empty. Without this,
  // a 403 would render "No academic year has been set up for this school
  // yet" — telling a bursar their school is misconfigured when the real
  // fault is a permission regression. That is precisely the misdiagnosis
  // this whole change exists to remove, so the notice stays suppressed
  // unless the load actually succeeded.
  const [yearsFailed, setYearsFailed] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const { permissions } = useAuth();

  useEffect(() => {
    listAcademicYears()
      .then((rows) => {
        setYears(rows);
        // Default to the current year/term if one is flagged, same UX shortcut
        // debtors doesn't have but is a cheap, obvious win for a dashboard.
        const current = rows.find((y) => y.isCurrent);
        if (current) setYearId(current.id);
      })
      .catch((e) => {
        logFinanceError("listAcademicYears", e);
        setYearsFailed(true);
        setReferenceError(financeErrorMessage(e));
      })
      .finally(() => setYearsLoaded(true));
  }, []);

  useEffect(() => {
    setTermId("");
    setTerms([]);
    setTermsLoaded(false);
    setReferenceError(null);
    setDashboard(null);
    if (!yearId) return;
    listTerms(yearId)
      .then((rows) => {
        setTerms(rows);
        const current = rows.find((t) => t.isCurrent);
        if (current) setTermId(current.id);
      })
      .catch((e) => {
        logFinanceError("listDashboardTerms", e);
        setReferenceError(financeErrorMessage(e));
      })
      .finally(() => setTermsLoaded(true));
  }, [yearId]);

  useEffect(() => {
    setDashboard(null);
    setError(null);
    if (!termId) return;
    setLoading(true);
    getFinanceDashboard(termId)
      .then(setDashboard)
      .catch((e) => {
        // Previously stringified the raw error, which rendered the error's
        // class name ("ApiError: …") straight into the page. The raw error
        // still reaches the console; only the user-facing copy is sanitised.
        logFinanceError("getFinanceDashboard", e);
        setError(financeErrorMessage(e));
      })
      .finally(() => setLoading(false));
  }, [termId]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Finance dashboard</h1>

      {/* Term selector — identical pattern to /finance/debtors */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="fin-dash-year" className="mb-1 block text-sm font-medium text-foreground">Academic year</label>
          <select id="fin-dash-year"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={yearId}
            onChange={(e) => setYearId(e.target.value)}
          >
            <option value="">Select year…</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="fin-dash-term" className="mb-1 block text-sm font-medium text-foreground">Term</label>
          <select id="fin-dash-term"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
            disabled={!yearId}
          >
            <option value="">Select term…</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <InlineAlert title="Could not load finance dashboard" action={{ label: "Retry", onClick: () => window.location.reload() }}>
          {error}
        </InlineAlert>
      )}

      {referenceError && !error && (
        <InlineAlert title="Could not load academic information" action={{ label: "Retry", onClick: () => window.location.reload() }}>
          {referenceError}
        </InlineAlert>
      )}

      {/* Branded (not bare-text) loading state, matching the admin dashboard
          fix, 2026-08-02: this page is also real server-side aggregation
          (getFinanceDashboard), and `loading` already tracks that fetch's
          genuine pending duration exactly — honest by construction, no
          artificial minimum. Interim mitigation for Neon autosuspend cold
          starts (docs/deferred.md), not a fix for the underlying issue. */}
      {loading && <BrandLoadingInline />}

      {/* Ordered most-fundamental-first: no years at all, then no current
          year, then no terms under the selected year, then no current term.
          Each names the actual blocker instead of asking a bursar to fix it
          from a selector they have no permission to act on. The final branch
          is the original copy — reached only when the school IS configured
          and the user cleared a selector by hand, which is the one case where
          "select a term" is genuinely the right instruction. */}
      {/* A failed academic-years load leaves the page with two empty
          selectors and nothing else — silently blank. Say so instead. As of
          2026-08-21 this is what a bursar actually hits: GET /academic-years
          403s for them (see the service-layer role gate in
          academic-years.service.ts), so this branch is not hypothetical. */}
      {!termId && !loading && !error && !referenceError && yearsLoaded && yearsFailed && (
        <InlineAlert title="Could not load academic years.">
          <p className="font-medium">Could not load academic years.</p>
          <p className="mt-1">
            The finance dashboard needs an academic year and term to show figures. If this keeps
            happening, your account may not have access to academic records — ask your school
            administrator.
          </p>
        </InlineAlert>
      )}

      {!termId && !loading && !error && yearsLoaded && !yearsFailed && (
        <>
          {years.length === 0 ? (
            <AcademicSetupNotice
              message="No academic year has been set up for this school yet."
              canFix={hasPermission(permissions, "academic-year.create")}
            />
          ) : !years.some((y) => y.isCurrent) ? (
            <AcademicSetupNotice
              message="No academic year is marked as current."
              canFix={hasPermission(permissions, "academic-year.update")}
            />
          ) : yearId && termsLoaded && terms.length === 0 ? (
            <AcademicSetupNotice
              message="This academic year has no terms yet."
              canFix={hasPermission(permissions, "term.create")}
            />
          ) : yearId && termsLoaded && !terms.some((t) => t.isCurrent) ? (
            <AcademicSetupNotice
              message="No term is marked as current for this academic year."
              canFix={hasPermission(permissions, "term.update")}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Select an academic year and term to view the finance dashboard.
            </p>
          )}
        </>
      )}

      {dashboard && !loading && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Showing figures for <span className="font-medium text-foreground">{dashboard.termName}</span>
          </p>

          {/* Collection rate meter — a single ratio against a limit */}
          <Card>
            <CardContent className="pt-6">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-medium text-foreground">Collection rate</span>
                <span className="font-serif text-3xl font-medium text-foreground">
                  {dashboard.collectionRatePercent}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-primary/15">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.min(100, Math.max(0, dashboard.collectionRatePercent))}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatKobo(dashboard.totalCollected)} collected of {formatKobo(dashboard.totalInvoiced)} invoiced
              </p>
            </CardContent>
          </Card>

          {/* KPI row — plain descriptive numbers, text tokens throughout */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Total invoiced" value={formatKobo(dashboard.totalInvoiced)} />
            <StatCard label="Total collected" value={formatKobo(dashboard.totalCollected)} />
            <StatCard
              label="Outstanding balance"
              value={formatKobo(dashboard.outstandingBalance)}
              tone={dashboard.outstandingBalance > 0 ? "warning" : "default"}
            />
            <StatCard label="Debtor count" value={String(dashboard.debtorCount)} />
            <StatCard label="Total expenses" value={formatKobo(dashboard.totalExpenses)} />
            <StatCard
              label="Net position"
              value={formatKobo(dashboard.netPosition)}
              tone={dashboard.netPosition >= 0 ? "positive" : "negative"}
            />
          </div>
        </div>
      )}
    </div>
  );
}
