"use client";

import { useEffect, useState } from "react";

import type { AcademicYearDto, FinanceDashboardDto, TermDto } from "@school-kit/types";

import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { getFinanceDashboard } from "@/lib/finance/finance-api";
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
export default function FinanceDashboardPage() {
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [yearId, setYearId] = useState("");
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");

  const [dashboard, setDashboard] = useState<FinanceDashboardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        console.error("[FinanceDashboardPage] listAcademicYears:", e);
      });
  }, []);

  useEffect(() => {
    setTermId("");
    setTerms([]);
    setDashboard(null);
    if (!yearId) return;
    listTerms(yearId)
      .then((rows) => {
        setTerms(rows);
        const current = rows.find((t) => t.isCurrent);
        if (current) setTermId(current.id);
      })
      .catch(() => setTerms([]));
  }, [yearId]);

  useEffect(() => {
    setDashboard(null);
    setError(null);
    if (!termId) return;
    setLoading(true);
    getFinanceDashboard(termId)
      .then(setDashboard)
      .catch((e) => {
        setError(String(e));
      })
      .finally(() => setLoading(false));
  }, [termId]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Finance dashboard</h1>

      {/* Term selector — identical pattern to /finance/debtors */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Academic year</label>
          <select
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
          <label className="mb-1 block text-sm font-medium text-foreground">Term</label>
          <select
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
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!termId && !loading && (
        <p className="text-sm text-muted-foreground">
          Select an academic year and term to view the finance dashboard.
        </p>
      )}

      {dashboard && !loading && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Showing figures for <span className="font-medium text-foreground">{dashboard.termName}</span>
          </p>

          {/* Collection rate meter — a single ratio against a limit */}
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-medium text-foreground">Collection rate</span>
              <span className="text-2xl font-semibold text-foreground">
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
          </div>

          {/* KPI row — plain descriptive numbers, text tokens throughout */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatTile label="Total invoiced" value={formatKobo(dashboard.totalInvoiced)} />
            <StatTile label="Total collected" value={formatKobo(dashboard.totalCollected)} />
            <StatTile
              label="Outstanding balance"
              value={formatKobo(dashboard.outstandingBalance)}
              tone={dashboard.outstandingBalance > 0 ? "warning" : "default"}
            />
            <StatTile label="Debtor count" value={String(dashboard.debtorCount)} />
            <StatTile label="Total expenses" value={formatKobo(dashboard.totalExpenses)} />
            <StatTile
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

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const toneClasses: Record<typeof tone, string> = {
    default: "text-foreground",
    positive: "text-emerald-700 dark:text-emerald-400",
    negative: "text-red-700 dark:text-red-400",
    warning: "text-amber-700 dark:text-amber-400",
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${toneClasses[tone]}`}>{value}</p>
    </div>
  );
}
