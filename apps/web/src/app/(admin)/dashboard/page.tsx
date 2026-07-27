"use client";

import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { AdminDashboardDto, DashboardAlertType } from "@school-kit/types";

import { AttendanceSparkline } from "@/components/admin/attendance-sparkline";
import { CommandDialog } from "@/components/admin/command-dialog";
import { AlertList } from "@/components/shared/alert-list";
import { ProgressMeter } from "@/components/shared/progress-meter";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminDashboard } from "@/lib/dashboard/dashboard-api";
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
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const termId = searchParams.get("termId") ?? "";
  const noAcademicYear = searchParams.get("noAcademicYear") === "1";

  const [dashboard, setDashboard] = useState<AdminDashboardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    if (!termId) return;
    setLoading(true);
    setError(null);
    getAdminDashboard(termId)
      .then(setDashboard)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
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
  if (!termId || loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!dashboard) return null;

  // A school with nothing enrolled and nothing billed yet has nothing real
  // to show — the KPI grid would just be a wall of zeros. Keep the original
  // onboarding nudge instead of faking a populated dashboard.
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
        <Card>
          <CardHeader className="items-start">
            <div className="flex items-center gap-3">
              <GraduationCap className="h-6 w-6 text-muted-foreground" />
              <CardTitle className="text-lg">Get started by adding your first student</CardTitle>
            </div>
            <CardDescription className="ml-9">
              Build your roster one student at a time — bulk CSV import is available from Students.
            </CardDescription>
          </CardHeader>
          <CardContent className="ml-9">
            <Button asChild>
              <Link href="/students/new">Add a student</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const enrolledDelta =
    dashboard.enrolled.previousTermCount === null
      ? null
      : dashboard.enrolled.count - dashboard.enrolled.previousTermCount;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground sm:text-4xl">
            {greeting()}, {user?.firstName ?? ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {dashboard.termName} · Live as of{" "}
            {new Date(dashboard.asOf).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCommandOpen(true)}>
            A · Command
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push("/finance/dashboard")}>
            B · Ledger
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Enrolled"
          value={String(dashboard.enrolled.count)}
          context={
            enrolledDelta === null
              ? "No prior term to compare"
              : `${enrolledDelta >= 0 ? "+" : ""}${enrolledDelta} vs last term`
          }
        />
        <StatCard
          label="Fees collected"
          value={formatKobo(dashboard.fees.collected)}
          context={`${dashboard.fees.percent}% of ${formatKobo(dashboard.fees.billed)} billed`}
        />
        <StatCard
          label="Attendance today"
          value={`${dashboard.attendanceToday.percentPresent}%`}
          context={`${dashboard.attendanceToday.absentCount} absent of ${dashboard.attendanceToday.totalMarked} marked`}
        />
        <StatCard
          label="Outstanding"
          value={formatKobo(dashboard.outstanding.amount)}
          context={`${dashboard.outstanding.debtorCount} in arrears`}
          tone={dashboard.outstanding.amount > 0 ? "warning" : "default"}
        />
      </div>

      {/* Two-column: collection breakdown + needs you today */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Collection by class level</CardTitle>
            <CardDescription>Fees billed vs. collected this term, by class level.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {dashboard.collectionByGroup.length === 0 && (
              <p className="text-sm text-muted-foreground">No invoices issued this term yet.</p>
            )}
            {dashboard.collectionByGroup.map((group) => (
              <ProgressMeter key={group.groupId} label={group.label} percent={group.percent} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs you today</CardTitle>
            <CardDescription>Real, current-state items — not scoped to the term above.</CardDescription>
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

      {/* Attendance trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance, last eight weeks</CardTitle>
        </CardHeader>
        <CardContent>
          <AttendanceSparkline weeks={dashboard.attendanceTrend} />
        </CardContent>
      </Card>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
