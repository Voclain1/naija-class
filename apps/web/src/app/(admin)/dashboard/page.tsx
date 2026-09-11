"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarCheck, ClipboardList, Users, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import type { AdminDashboardDto, DashboardAlertType } from "@school-kit/types";

import { AttendanceSparkline } from "@/components/admin/attendance-sparkline";
import { DashboardActionBar } from "@/components/admin/dashboard-action-bar";
import { SchoolProfileCard } from "@/components/admin/school-profile-card";
import { CollectionByLevel } from "@/components/finance/collection-by-level";
import { BrandLoadingInline } from "@/components/brand-loading-screen";
import { Badge } from "@/components/ui/badge";
import { AlertList } from "@/components/shared/alert-list";
import { InlineAlert } from "@/components/shared/inline-alert";
import { SetupChecklist } from "@/components/setup/setup-checklist";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminDashboard } from "@/lib/dashboard/dashboard-api";
import { dashboardErrorMessage } from "@/lib/dashboard/dashboard-error-copy";
import { formatKobo } from "@/lib/finance/format";
import { useAuth } from "@/lib/auth/use-auth";

const ALERT_LABELS: Record<DashboardAlertType, string> = {
  overdue_fees: "Overdue invoices",
  pending_report_card_approval: "Report cards awaiting your approval",
  pending_staff_invitations: "Pending staff invitations",
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { user, school } = useAuth();
  const searchParams = useSearchParams();
  const termId = searchParams.get("termId") ?? "";
  const noAcademicYear = searchParams.get("noAcademicYear") === "1";

  const [dashboard, setDashboard] = useState<AdminDashboardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!termId) return;
    // Superseded-response guard. Without it, switching term while a fetch is
    // in flight lets the OLD request settle over the new one — and because
    // `error` is checked before `dashboard` when rendering below, a stale
    // rejection landing after a fresh success shows the error banner over
    // data that loaded perfectly well. The stale `.finally` would also clear
    // `loading` while the current request was still running.
    let current = true;
    setLoading(true);
    setError(null);
    getAdminDashboard(termId)
      .then((d) => {
        if (current) setDashboard(d);
      })
      .catch((e) => {
        // dashboardErrorMessage still runs for a superseded request: the
        // failure was real and worth capturing even though this render no
        // longer wants to show it.
        const message = dashboardErrorMessage(e);
        if (current) setError(message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [termId]);

  // A brand-new school (every real signup) has no academic year yet — the
  // term selector in the topbar sets ?noAcademicYear=1 once it confirms
  // there's genuinely nothing to select, rather than this page waiting on a
  // termId that will never arrive (found via the real e2e happy-path run,
  // 2026-07-26 — this is the FIRST state every new school's dashboard hits).
  if (noAcademicYear) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Set up your academic year and terms to see your dashboard.
          </p>
        </div>
        <Card>
          <CardHeader className="items-start">
            <CardTitle className="text-lg">Set up your first academic year</CardTitle>
            <CardDescription>
              Define your academic year and terms first — everything else on this dashboard is scoped
              to a term.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/settings/academic/years">Set up academic year</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // The term selector lives in the topbar and writes ?termId= once it
  // resolves the school's current term — until then, this page just waits.
  //
  // Branded (not bare-text) loading state, 2026-08-02: this page does real
  // server-side aggregation (enrollment + fees + attendance + report-card +
  // invitation counts in one call) and is the most-viewed page in the app,
  // so a slow fetch here — e.g. a Neon free-tier cold-start reconnect — is
  // the worst place to show a frozen/blank screen. `loading` already tracks
  // the real fetch's actual pending duration exactly (set true immediately
  // before getAdminDashboard(), false in its .finally()), so rendering
  // BrandLoadingInline here for as long as this condition holds is honest by
  // construction — no artificial minimum duration, no fixed timer. This is
  // an interim mitigation for the Neon autosuspend issue, not a fix for it —
  // see docs/deferred.md.
  if (!termId || loading) {
    return <BrandLoadingInline />;
  }

  if (error) {
    return (
      <InlineAlert title="Could not load dashboard" action={{ label: "Retry", onClick: () => window.location.reload() }}>
        {error}
      </InlineAlert>
    );
  }

  if (!dashboard) return null;

  // A school with nothing enrolled and nothing billed yet has nothing real
  // to show — the KPI grid would just be a wall of zeros. Show the setup
  // checklist instead of faking a populated dashboard.
  //
  // This replaced a single "Get started by adding your first student" card
  // (F-25, 2026-08-29). That card was not wrong, it was alone: it named the
  // second of three required steps, said nothing about the third (enrolling
  // those students into a class, without which every register, invoice and
  // report card stays empty), and gave an owner no way to tell what else was
  // waiting or what had already been done for them. SetupChecklist answers
  // all four questions from real persisted state.
  const isEmpty = dashboard.enrolled.count === 0 && dashboard.fees.billed === 0;
  if (isEmpty) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Once your school is set up, this is where the day-to-day will live.
          </p>
        </div>
        <SetupChecklist />
      </div>
    );
  }

  const enrolledDelta =
    dashboard.enrolled.previousTermCount === null
      ? null
      : dashboard.enrolled.count - dashboard.enrolled.previousTermCount;

  const actionItemCount = dashboard.needsYouToday.reduce((total, a) => total + a.count, 0);

  return (
    <div className="flex flex-col gap-8">
      {/* The A/B quick actions live in the TOPBAR, not here. This page used to
          render its own "A · Command" / "B · Ledger" pair plus a second
          CommandDialog instance, which meant /dashboard showed both sets at
          once after the topbar pills shipped. The topbar version is the one to
          keep: it is present on every admin page, its Ledger action is
          permission-gated off the filtered nav list (the page-level one was
          NOT — it rendered for roles that would 403 on /finance/dashboard),
          and its accessible names are real phrases rather than "A · Command".
          See components/admin/quick-action-pills.tsx. */}
      {/* Greeting and actions share ONE row (flex-wrap, so the buttons drop
          under the greeting on narrow screens rather than overflowing it).
          The status pill and the brief line stay inside the greeting block. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
        {/* Freshness first, and it is a real claim: `asOf` is stamped by the
            server when it computed THIS response, not a client clock. The dot
            is decorative — the text carries the meaning. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
            Live as of{" "}
            {new Date(dashboard.asOf).toLocaleTimeString("en-NG", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <span className="text-muted-foreground">{dashboard.termName}</span>
        </div>

        <h1 className="mt-3 font-serif text-2xl font-medium tracking-tight text-foreground sm:text-4xl">
          {greeting()}, {user?.firstName ?? ""}
        </h1>
        {school?.name && (
          <p className="mt-1 text-sm text-muted-foreground">
            Here is your daily administrative brief for {school.name}.
          </p>
        )}
        </div>

        <DashboardActionBar />
      </div>

      {/* A partly-configured school reaches this branch as soon as it has one
          enrolled student or one billed fee — well before setup is finished.
          SetupChecklist renders nothing once the API calls the school
          established, so this is not permanent furniture; it is here so that
          progress on the roster does not make the remaining steps vanish. */}
      <SetupChecklist />

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Enrolled"
          value={String(dashboard.enrolled.count)}
          icon={<Users className="h-4 w-4" />}
          context={
            enrolledDelta === null
              ? "No prior term to compare"
              : `${enrolledDelta >= 0 ? "+" : ""}${enrolledDelta} vs last term`
          }
          footer="Pupils on the active register"
        />
        <StatCard
          label="Fees collected"
          value={formatKobo(dashboard.fees.collected)}
          icon={<Wallet className="h-4 w-4" />}
          context={`${dashboard.fees.percent}% of ${formatKobo(dashboard.fees.billed)} billed`}
          footer={
            // A meter, not a second number: one ratio against a limit. Capped
            // so an over-collection (prepayments) cannot draw past the track.
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, dashboard.fees.percent))}%` }}
              />
            </div>
          }
        />
        <StatCard
          label="Attendance today"
          value={
            // 0 marked is NOT 0% present — the register simply has not been
            // taken yet. Same no-data-vs-zero distinction the trend chart and
            // the trajectory both encode.
            dashboard.attendanceToday.totalMarked === 0
              ? "—"
              : `${dashboard.attendanceToday.percentPresent}%`
          }
          icon={<CalendarCheck className="h-4 w-4" />}
          context={
            dashboard.attendanceToday.totalMarked === 0
              ? "No register taken yet today"
              : `${dashboard.attendanceToday.absentCount} absent of ${dashboard.attendanceToday.totalMarked} marked`
          }
          footer={`${dashboard.schoolProfile.completeness.attendanceToday.done} of ${dashboard.schoolProfile.completeness.attendanceToday.total} classes marked`}
        />
        <StatCard
          label="Outstanding"
          value={formatKobo(dashboard.outstanding.amount)}
          icon={<ClipboardList className="h-4 w-4" />}
          context={`${dashboard.outstanding.debtorCount} in arrears`}
          tone={dashboard.outstanding.amount > 0 ? "warning" : "default"}
          footer="Across issued, unpaid invoices"
        />
      </div>

      {/* Collection gets the wide column and "Needs you today" the narrow one.
          Previously these two plus the profile card shared a 2-up grid, which
          left whichever card came third stranded on its own row. A 3-column
          track with a 2-wide first card gives the breakdown the room its rows
          need and keeps the action list beside it rather than under it. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-serif text-lg font-medium">Collection by class level</CardTitle>
            <CardDescription>Fees billed vs. collected this term, by class level.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Shared with /finance/dashboard — one component, so the two
                screens cannot disagree about what a group row means. */}
            <CollectionByLevel groups={dashboard.collectionByGroup} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="font-serif text-lg font-medium">Needs you today</CardTitle>
              {/* A real total, summed from the same rows rendered below — not
                  a decorative badge. Hidden entirely at zero rather than
                  showing "0 items", which would draw the eye to nothing. */}
              {actionItemCount > 0 && (
                // The shared Badge, not a hand-rolled span. The first version
                // used bg-secondary/20 — Gold Spark at 20% opacity over Paper,
                // which is a pale beige wash that does not read as gold at all.
                // Badge's "secondary" variant uses the FULL token with
                // secondary-foreground on top, which is a real gold pill with
                // dark text in both themes (both are defined in globals.css).
                <Badge variant="secondary" className="shrink-0">
                  {actionItemCount} {actionItemCount === 1 ? "item" : "items"}
                </Badge>
              )}
            </div>
            <CardDescription>
              Overdue invoices, pending approvals, and staff invitations that need action.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertList
              items={dashboard.needsYouToday.map((alert) => ({
                key: alert.type,
                label: ALERT_LABELS[alert.type],
                count: alert.count,
                href: alert.href,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* School profile — the school's actual state right now. No status
            light and no "last synced" line; see school-profile-card.tsx. */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg font-medium">School profile</CardTitle>
          </CardHeader>
          <CardContent>
            <SchoolProfileCard profile={dashboard.schoolProfile} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg font-medium">Attendance, last eight weeks</CardTitle>
            <CardDescription>
              Weeks with no register taken are left blank, not drawn as zero.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AttendanceSparkline weeks={dashboard.attendanceTrend} />
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
