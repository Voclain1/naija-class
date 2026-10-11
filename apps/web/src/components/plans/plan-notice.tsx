"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { SchoolPlanDto } from "@school-kit/types";

import { getSchoolPlan } from "@/lib/plans/plans-api";
import { planConsequenceSentence, planUsageSentence } from "@/lib/plans/plan-copy";

// The Students page notice when the school is near or past its plan's student
// cap (docs/modules/plans.md). Silent while there is room, and silent if the
// plan cannot be read: it is advice, and a failed fetch must not put an error
// on the roster.
export function PlanNotice() {
  const [plan, setPlan] = useState<SchoolPlanDto | null>(null);

  useEffect(() => {
    let live = true;
    getSchoolPlan()
      .then((p) => {
        if (live) setPlan(p);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!plan || plan.status === "ok") return null;
  const blocking = plan.enforcement === "enforce" && plan.status === "over";

  return (
    <div
      data-testid="plan-notice"
      className={`mb-4 flex flex-wrap items-start justify-between gap-3 rounded-md border px-4 py-3 ${
        blocking ? "border-destructive/40 bg-destructive/5" : "border-secondary/50 bg-secondary/10"
      }`}
    >
      <div className="flex min-w-0 gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {plan.status === "over" ? "Over your plan's student limit" : "Close to your plan's student limit"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {planUsageSentence(plan)} {planConsequenceSentence(plan)}
          </p>
        </div>
      </div>
      <Link href="/settings/plan" className="shrink-0 text-sm underline">
        See your plan
      </Link>
    </div>
  );
}
