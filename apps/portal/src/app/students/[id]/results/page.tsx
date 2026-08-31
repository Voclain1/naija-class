"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PortalStudentDto, ReleasedResultSummaryDto } from "@school-kit/types";

import { SignOutButton } from "@/components/sign-out-button";
import { buildLoginUrl, errorCodeFromBody, reasonFromErrorCode } from "@/lib/session-end";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; student: PortalStudentDto; results: ReleasedResultSummaryDto[] };

function formatAverage(hundredths: number | null): string {
  if (hundredths === null) return "—";
  return `${Math.trunc(hundredths / 100)}.${Math.abs(hundredths % 100)
    .toString()
    .padStart(2, "0")}%`;
}

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [studentResponse, resultsResponse] = await Promise.all([
          fetch(`/api/portal/students/${params.id}`),
          fetch(`/api/portal/students/${params.id}/results`),
        ]);
        if (studentResponse.status === 401 || resultsResponse.status === 401) {
          const unauthorised = studentResponse.status === 401 ? studentResponse : resultsResponse;
          const body: unknown = await unauthorised.json().catch(() => null);
          if (!cancelled) setState({ kind: "loading" });
          router.replace(
            buildLoginUrl({
              reason: reasonFromErrorCode(errorCodeFromBody(body)),
              next: `${window.location.pathname}${window.location.search}`,
            }),
          );
          return;
        }
        if (!studentResponse.ok || !resultsResponse.ok) {
          if (!cancelled) setState({ kind: "error" });
          return;
        }
        const [student, body] = await Promise.all([
          studentResponse.json() as Promise<PortalStudentDto>,
          resultsResponse.json() as Promise<{ data: ReleasedResultSummaryDto[] }>,
        ]);
        if (!cancelled) setState({ kind: "loaded", student, results: body.data });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.id, router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href={`/students/${params.id}`} className="text-sm text-muted-foreground hover:underline">
          ← Back to child
        </Link>
        <SignOutButton />
      </div>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Released results</h1>
        {state.kind === "loaded" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {state.student.firstName} {state.student.lastName} · only report cards the school has
            published appear here.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Only report cards the school has published appear here.
          </p>
        )}
      </header>
      {state.kind === "loading" && <p className="text-sm text-muted-foreground">Loading results…</p>}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t load results. Try again shortly.
        </p>
      )}
      {state.kind === "loaded" &&
        (state.results.length === 0 ? (
          <section className="rounded-lg border border-dashed bg-card p-6 text-center">
            <h2 className="font-semibold">Nothing released yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              When the school publishes a term&apos;s report card, it will appear here.
            </p>
          </section>
        ) : (
          <section className="flex flex-col gap-3" aria-label="Released report cards">
            {state.results.map((result) => (
              <article key={result.reportCardId} className="rounded-lg border bg-card p-4 shadow-sm">
                <h2 className="font-semibold">{result.termName}</h2>
                <p className="text-sm text-muted-foreground">{result.academicYearLabel}</p>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="text-muted-foreground">Average</dt><dd>{formatAverage(result.overallAverage)}</dd></div>
                  <div><dt className="text-muted-foreground">Subjects</dt><dd>{result.subjectsCount ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Class</dt><dd>{result.classArmName}</dd></div>
                </dl>
              </article>
            ))}
          </section>
        ))}
    </main>
  );
}
