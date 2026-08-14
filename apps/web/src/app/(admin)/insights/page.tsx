"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import type { AskInsightResultDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { askInsight } from "@/lib/insights/insights-api";

// Duplicated per-file rather than a shared hook — same pattern as the settings
// screens. See docs/deferred.md ("Shared usePermissions hook").
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

// /insights — Phase 5 / Slice 8. An admin asks in their own words.
//
// THE ROUTED REPORT NAME IS SHOWN, ALWAYS. A misroute ("who owes fees?"
// answered with subject averages) is this feature's most likely failure, and
// prose alone would hide it — the summary would read perfectly well while
// answering the wrong question. Showing "Showing: Subject performance" above
// the answer makes a wrong turn obvious in a glance.
//
// The table renders from the API's computed rows, never from the paragraph.
// When narration is unavailable the figures still show; that is the intended
// degraded state, not an error.
const EXAMPLES = [
  "Which classes are struggling this term?",
  "Which students are at risk of failing?",
  "Which subjects are scoring worst?",
  "Where is attendance worst?",
];

export default function InsightsPage() {
  const { permissions } = useAuth();
  const canRead = hasPermission(permissions, "insight.read");
  const searchParams = useSearchParams();
  const termId = searchParams.get("termId") ?? "";

  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskInsightResultDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAsk(q: string): Promise<void> {
    if (!q.trim() || !termId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await askInsight({ question: q.trim(), termId }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not answer that — try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!canRead) {
    return (
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Insights</h1>
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          You don&apos;t have access to insights.
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Insights</h1>
        <p className="text-sm text-muted-foreground">
          Ask about this term&apos;s results and attendance. Every figure below is
          calculated from your own records.
        </p>
      </header>

      {!termId ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          Choose a term above to get started.
        </div>
      ) : (
        <>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void onAsk(question);
            }}
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={500}
                placeholder="Which classes are struggling this term?"
                className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
                aria-label="Ask a question about this term"
              />
              <Button type="submit" disabled={loading || question.trim().length < 3}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span className="ml-1">{loading ? "Thinking…" : "Ask"}</span>
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setQuestion(ex);
                    void onAsk(ex);
                  }}
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  {ex}
                </button>
              ))}
            </div>
          </form>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {result?.unsupported && (
            <div className="rounded-md border bg-card p-4 text-sm">
              <p className="font-medium">That one isn&apos;t something I can answer yet.</p>
              <p className="mt-1 text-muted-foreground">
                Right now I can cover class performance, subject performance,
                students at risk, and attendance. Fees, individual children and
                staff questions aren&apos;t covered.
              </p>
            </div>
          )}

          {result && !result.unsupported && result.data && (
            <section className="flex flex-col gap-4">
              {/* Shown even when the prose is present — see the header note. */}
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Showing: {REPORT_LABELS[result.data.intent]} · {result.termName}
              </p>

              {result.answer && (
                <p className="rounded-md border-l-2 border-primary bg-muted/30 p-4 text-sm leading-relaxed">
                  {result.answer}
                </p>
              )}

              <ResultTable data={result.data} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

const REPORT_LABELS: Record<AskInsightResultDto["intent"], string> = {
  "at-risk-students": "Students at risk",
  "underperforming-classes": "Class performance",
  "weakest-subjects": "Subject performance",
  "attendance-concerns": "Attendance concerns",
};

function ResultTable({ data }: { data: NonNullable<AskInsightResultDto["data"]> }) {
  if (data.rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Nothing to report for this term yet — that usually means marks or
        attendance haven&apos;t been entered.
      </p>
    );
  }

  // Wide tables scroll inside their own container rather than the page.
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {HEADERS[data.intent].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.intent === "at-risk-students" &&
            data.rows.map((r) => (
              <tr key={r.studentId} className="border-t">
                <td className="px-3 py-2">
                  {r.firstName} {r.lastName}
                </td>
                <td className="px-3 py-2">{r.classArmLabel}</td>
                <td className="px-3 py-2 tabular-nums">{pct(r.averageScore)}</td>
                <td className="px-3 py-2 tabular-nums">{pct(r.attendanceRate)}</td>
                <td className="px-3 py-2 tabular-nums">{r.subjectsBelowPass}</td>
              </tr>
            ))}
          {data.intent === "underperforming-classes" &&
            data.rows.map((r) => (
              <tr key={r.classArmId} className="border-t">
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 tabular-nums">{r.studentCount}</td>
                <td className="px-3 py-2 tabular-nums">{pct(r.averageScore)}</td>
                <td className="px-3 py-2 tabular-nums">{pct(r.attendanceRate)}</td>
              </tr>
            ))}
          {data.intent === "weakest-subjects" &&
            data.rows.map((r) => (
              <tr key={r.subjectId} className="border-t">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 tabular-nums">{pct(r.averageScore)}</td>
                <td className="px-3 py-2 tabular-nums">{r.belowPassCount}</td>
                <td className="px-3 py-2 tabular-nums">{r.scoredStudentCount}</td>
              </tr>
            ))}
          {data.intent === "attendance-concerns" &&
            data.rows.map((r) => (
              <tr key={r.classArmId} className="border-t">
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 tabular-nums">{pct(r.attendanceRate)}</td>
                <td className="px-3 py-2 tabular-nums">{r.studentsBelowThreshold}</td>
                <td className="px-3 py-2 tabular-nums">{r.daysMarked}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

const HEADERS: Record<AskInsightResultDto["intent"], string[]> = {
  "at-risk-students": ["Student", "Class", "Average", "Attendance", "Subjects below pass"],
  "underperforming-classes": ["Class", "Students", "Average", "Attendance"],
  "weakest-subjects": ["Subject", "Average", "Below pass", "Results"],
  "attendance-concerns": ["Class", "Attendance", "Students below 75%", "Register entries"],
};

// Null is "not recorded", not zero — an empty register and a 0% attendance
// rate are very different claims to make about a class.
function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}
