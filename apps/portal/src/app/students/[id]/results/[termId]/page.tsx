"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PROMOTION_STATUS_LABELS, type ReleasedResultDetailDto } from "@school-kit/types";

import { Appear, PageHeader, PageSkeleton } from "@school-kit/ui";

import { SignOutButton } from "@/components/sign-out-button";
import { buildLoginUrl, errorCodeFromBody, reasonFromErrorCode } from "@/lib/session-end";

// One released term, in full (Phase 8 / CP6a, §20.4). The portal had only the
// list until now; this is the card a parent opens, carrying what the printed
// report card carries: subjects, comments, the principal's remark, attendance,
// the promotion status on the final term, and position when the school shows
// it to families.
//
// Addressed by TERM, like the app: the API's lookup includes the student id,
// so a card belonging to another child cannot be addressed from here at all.

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "missing" }
  | { kind: "loaded"; result: ReleasedResultDetailDto };

function formatAverage(hundredths: number | null): string {
  if (hundredths === null) return "—";
  return `${Math.trunc(hundredths / 100)}.${Math.abs(hundredths % 100)
    .toString()
    .padStart(2, "0")}%`;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

export default function ResultDetailPage() {
  const params = useParams<{ id: string; termId: string }>();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/portal/students/${params.id}/results/${params.termId}`);
        if (response.status === 401) {
          const body: unknown = await response.json().catch(() => null);
          router.replace(
            buildLoginUrl({
              reason: reasonFromErrorCode(errorCodeFromBody(body)),
              next: `${window.location.pathname}${window.location.search}`,
            }),
          );
          return;
        }
        if (response.status === 404) {
          if (!cancelled) setState({ kind: "missing" });
          return;
        }
        if (!response.ok) {
          if (!cancelled) setState({ kind: "error" });
          return;
        }
        const result = (await response.json()) as ReleasedResultDetailDto;
        if (!cancelled) setState({ kind: "loaded", result });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.id, params.termId, router]);

  const result = state.kind === "loaded" ? state.result : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-2">
        <Link
          href={`/students/${params.id}/results`}
          className="self-start text-sm text-muted-foreground hover:underline"
        >
          ← All results
        </Link>
        <PageHeader
          title={result ? `${result.termName} report card` : "Report card"}
          subtitle={
            result
              ? `${result.student.firstName} ${result.student.lastName} · ${result.academicYearLabel} · ${result.classArmName}`
              : undefined
          }
          actions={<SignOutButton />}
        />
      </div>

      {state.kind === "loading" && <PageSkeleton rows={3} />}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t load this report card. Try again shortly.
        </p>
      )}
      {state.kind === "missing" && (
        <p className="text-sm text-muted-foreground">
          There is no published report card for this term.
        </p>
      )}

      {result && (
        <Appear>
          <div className="flex flex-col gap-4">
            {result.promotionStatus ? (
              // Tinted, never an accent border (CLAUDE.md); the decision in words.
              <section className="rounded-lg bg-primary/10 p-4" aria-label="Promotion status">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Promotion status</p>
                <p className="font-serif text-xl text-foreground">{PROMOTION_STATUS_LABELS[result.promotionStatus]}</p>
              </section>
            ) : null}

            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Average</dt><dd>{formatAverage(result.overallAverage)}</dd></div>
                <div><dt className="text-muted-foreground">Total</dt><dd>{result.overallTotal ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground">Subjects</dt><dd>{result.subjectsCount ?? "—"}</dd></div>
                {/* Only when the school shows position to families; never a dash. */}
                {result.overallPosition !== null ? (
                  <div><dt className="text-muted-foreground">Position</dt><dd>{ordinal(result.overallPosition)}</dd></div>
                ) : null}
              </dl>
              {result.attendance ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Attendance: present {result.attendance.present} of {result.attendance.daysOpened} days, absent{" "}
                  {result.attendance.absent}.
                </p>
              ) : null}
            </section>

            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <h2 className="mb-2 font-semibold">Subjects</h2>
              {result.subjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No subject scores were recorded for this term.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 font-normal">Subject</th>
                      <th className="py-1 text-right font-normal">Score</th>
                      <th className="py-1 text-right font-normal">Grade</th>
                      {result.subjects.some((s) => s.subjectPosition !== null) ? (
                        <th className="py-1 text-right font-normal">Position</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {result.subjects.map((s) => (
                      <tr key={s.subjectId} className="border-t">
                        <td className="py-1.5">
                          {s.subjectName}
                          {s.remark ? <span className="block text-xs text-muted-foreground">{s.remark}</span> : null}
                        </td>
                        <td className="py-1.5 text-right">{s.totalScore}</td>
                        <td className="py-1.5 text-right">{s.letterGrade ?? "—"}</td>
                        {result.subjects.some((x) => x.subjectPosition !== null) ? (
                          <td className="py-1.5 text-right">
                            {s.subjectPosition !== null ? ordinal(s.subjectPosition) : "—"}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {result.formTeacherComment ? (
              <section className="rounded-lg border bg-card p-4 shadow-sm">
                <h2 className="mb-1 font-semibold">Form teacher&apos;s comment</h2>
                <p className="whitespace-pre-wrap text-sm">{result.formTeacherComment}</p>
              </section>
            ) : null}
            {result.principalNote ? (
              <section className="rounded-lg border bg-card p-4 shadow-sm">
                <h2 className="mb-1 font-semibold">Principal&apos;s remark</h2>
                <p className="whitespace-pre-wrap text-sm">{result.principalNote}</p>
              </section>
            ) : null}
          </div>
        </Appear>
      )}
    </main>
  );
}
