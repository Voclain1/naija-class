"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { AiUsageDto } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { getAiUsage } from "@/lib/ai-usage/ai-usage-api";
import { useAuth } from "@/lib/auth/use-auth";
import { cn } from "@/lib/utils";

// Duplicated per-file rather than a shared hook — same pattern as the other
// settings screens. See docs/deferred.md ("Shared usePermissions hook").
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

// /settings/ai-usage — closes the `ai-usage.read` gap: the permission has
// existed since Phase 5 / Slice 1 and had no screen behind it, so a school
// running four AI features could not see what they cost or how much headroom
// was left.
//
// NOT A BILL. AI cost is platform-subsidised (D6) — no school is invoiced for
// tokens and there is no plan or tier concept in the product. The copy has to
// carry that, or an owner reading "$2.14" reasonably assumes it is theirs to
// pay. The dollar figure is shown anyway because "how much is this costing"
// is the question people actually have, and hiding it would be worse.
export default function AiUsagePage() {
  const { permissions } = useAuth();
  const canRead = hasPermission(permissions, "ai-usage.read");

  const [data, setData] = useState<AiUsageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAiUsage(3));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load usage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canRead) void load();
    else setLoading(false);
  }, [canRead, load]);

  if (!canRead) {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">AI usage</h1>
        </header>
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          You don&apos;t have access to this setting.
        </div>
      </div>
    );
  }

  const current = data?.periods[0];
  // Reserved, not actual — mid-flight reservations are headroom the school
  // genuinely cannot use, and the budget check enforces against this number.
  const used = current?.tokensReserved ?? 0;
  const budget = data?.monthlyTokenBudget ?? 0;
  const percent = budget > 0 ? Math.min(100, Math.round((used * 100) / budget)) : 0;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">AI usage</h1>
        <p className="text-sm text-muted-foreground">
          What the AI features have used this month, and how much of your
          monthly allowance is left.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-6">
          {!data.aiConfigured && (
            <p className="text-sm text-amber-700">
              AI isn&apos;t configured on this deployment yet, so nothing has been used.
            </p>
          )}
          {!data.aiEnabled && (
            <p className="text-sm text-amber-700">AI is switched off for this school.</p>
          )}

          <section className="flex flex-col gap-2 rounded-md border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">This month</span>
              <span className="font-serif text-2xl">{percent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  percent >= 90 ? "bg-destructive" : "bg-primary",
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {used.toLocaleString("en-NG")} of {budget.toLocaleString("en-NG")} tokens ·{" "}
              {current?.callCount.toLocaleString("en-NG") ?? 0} generations ·{" "}
              {formatUsd(current?.costMicroUsd ?? 0)} of platform cost
            </p>
            <p className="text-xs text-muted-foreground">
              This allowance is included — your school is not billed for it.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">What used it this month</h2>
            {data.byPrompt.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing generated yet this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Feature</th>
                      <th className="py-2 pr-4 text-right font-medium">Generations</th>
                      <th className="py-2 pr-4 text-right font-medium">Tokens</th>
                      <th className="py-2 text-right font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byPrompt.map((p) => (
                      <tr key={p.promptName} className="border-b last:border-0">
                        <td className="py-2 pr-4">{promptLabel(p.promptName)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {p.callCount.toLocaleString("en-NG")}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {p.totalTokens.toLocaleString("en-NG")}
                        </td>
                        {/* Failures are shown rather than hidden: they cost
                            money too, and a rising count is the signal this
                            table exists to surface. */}
                        <td
                          className={cn(
                            "py-2 text-right tabular-nums",
                            p.failureCount > 0 ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {p.failureCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.periods.length > 1 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">Previous months</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {data.periods.slice(1).map((p) => (
                  <li key={String(p.periodStart)} className="flex justify-between border-b py-1.5 last:border-0">
                    <span>{formatMonth(p.periodStart)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {p.tokensActual.toLocaleString("en-NG")} tokens · {p.callCount} generations
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Prompt names are registry ids ("report-card-subject-comment"), not something
// to put in front of an owner. Unknown names fall back to the raw id rather
// than being hidden — a new prompt showing up as its id is a smaller problem
// than spend that appears nowhere.
const PROMPT_LABELS: Record<string, string> = {
  "lesson-plan": "Lesson plans",
  "lesson-quiz": "Lesson quizzes",
  "report-card-subject-comment": "Report card — subject comments",
  "report-card-form-comment": "Report card — form teacher comments",
  "parent-weekly-summary": "Weekly parent updates",
  "connectivity-check": "System check",
};

function promptLabel(name: string): string {
  return PROMPT_LABELS[name] ?? name;
}

// Micro-USD (D2) — integer, never converted to naira, because no FX rate
// exists in this system.
function formatUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

function formatMonth(periodStart: string | Date): string {
  const d =
    typeof periodStart === "string"
      ? new Date(`${periodStart.slice(0, 10)}T00:00:00Z`)
      : periodStart;
  return d.toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });
}
