"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { SchoolPlanDto } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { getSchoolPlan } from "@/lib/plans/plans-api";
import { planConsequenceSentence, planFeatureStatus, planUsageSentence } from "@/lib/plans/plan-copy";
import { cn } from "@/lib/utils";

// /settings/plan — the school's plan, its student limit and where the school
// is against it (docs/modules/plans.md). Read-only: SchoolKit sets the plan,
// and there is no billing in the app yet.
export default function PlanPage() {
  const { permissions } = useAuth();
  const canRead = hasPermission(permissions, "school.update");

  const [plan, setPlan] = useState<SchoolPlanDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPlan(await getSchoolPlan());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your plan.");
    }
  }, []);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  const header = (
    <header className="flex flex-col gap-2">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Plan</h1>
      <p className="text-sm text-muted-foreground">Your school&apos;s plan and how many students it covers.</p>
    </header>
  );

  if (!canRead) {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-4">
        {header}
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          You don&apos;t have access to this setting.
        </div>
      </div>
    );
  }

  const percent =
    plan && plan.studentCap ? Math.min(100, Math.round((plan.studentsOnRoll * 100) / plan.studentCap)) : 0;
  const consequence = plan ? planConsequenceSentence(plan) : null;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8">
      {header}

      {error ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : !plan ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <section className="flex flex-col gap-4 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-serif text-xl font-medium">{plan.label} plan</h2>
            <span className="text-sm tabular-nums text-muted-foreground">
              {plan.studentCap === null
                ? `${plan.studentsOnRoll.toLocaleString("en-NG")} students`
                : `${plan.studentsOnRoll.toLocaleString("en-NG")} of ${plan.studentCap.toLocaleString("en-NG")} students`}
            </span>
          </div>
          {plan.studentCap !== null ? (
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Students on the roll against your plan's limit"
              aria-valuemin={0}
              aria-valuemax={plan.studentCap}
              aria-valuenow={plan.studentsOnRoll}
            >
              <div
                className={cn("h-full rounded-full", plan.status === "ok" ? "bg-primary" : "bg-secondary")}
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : null}
          <p className="text-sm">
            {planUsageSentence(plan)}
            {consequence ? ` ${consequence}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            Students who have withdrawn or graduated don&apos;t count. To change your plan, contact the SchoolKit team.
          </p>
        </section>
      )}

      {plan ? (
        <section className="flex flex-col gap-3" aria-labelledby="plan-features">
          <h2 id="plan-features" className="font-medium">
            Paid-plan extras
          </h2>
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {plan.features.map((f) => (
              <li key={f.feature} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>{f.label}</span>
                <span className={f.available ? "text-muted-foreground" : "font-medium text-amber-900"}>
                  {planFeatureStatus(f)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Every plan gets printable report cards with scores, grades and comments.
          </p>
        </section>
      ) : null}

      {plan ? (
        <section className="flex flex-col gap-2" aria-labelledby="plan-emails">
          <h2 id="plan-emails" className="font-medium">
            Announcement emails
          </h2>
          <p className="text-sm text-muted-foreground">
            Your {plan.label} plan can email up to {plan.announcementEmailsPerDay.toLocaleString("en-NG")} announcement
            emails a day. Past that, the rest are not sent, and the announcement says how many.
          </p>
        </section>
      ) : null}
    </div>
  );
}
