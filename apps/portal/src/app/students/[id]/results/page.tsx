"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PortalStudentDto, ReleasedResultSummaryDto } from "@school-kit/types";

import { Appear, PageHeader, PageSkeleton } from "@school-kit/ui";

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
      <div className="flex flex-col gap-2">
        <Link href={`/students/${params.id}`} className="self-start text-sm text-muted-foreground hover:underline">
          ← Back to child
        </Link>
        <PageHeader
          title="Released results"
          subtitle={
            state.kind === "loaded"
              ? `${state.student.firstName} ${state.student.lastName} · only report cards the school has published appear here.`
              : "Only report cards the school has published appear here."
          }
          actions={<SignOutButton />}
        />
      </div>
      {state.kind === "loading" && <PageSkeleton rows={2} />}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t load results. Try again shortly.
        </p>
      )}
      {state.kind === "loaded" &&
        (state.results.length === 0 ? (
          // EmptyState's look, but not EmptyState itself: this title is an h2
          // that guardian-released-results.spec.ts finds by role, and
          // EmptyState renders its title as a paragraph.
          <section className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/30 p-8 text-center">
            <h2 className="font-medium text-foreground">Nothing released yet</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              When the school publishes a term&apos;s report card, it will appear here.
            </p>
          </section>
        ) : (
          <Appear>
            <section className="flex flex-col gap-3" aria-label="Released report cards">
              {state.results.map((result) => (
                <article key={result.reportCardId} className="rounded-lg border bg-card p-4 shadow-sm">
                  <h2 className="font-semibold">
                    <Link href={`/students/${params.id}/results/${result.termId}`} className="hover:underline">
                      {result.termName}
                    </Link>
                  </h2>
                  <p className="text-sm text-muted-foreground">{result.academicYearLabel}</p>
                  {result.locked ? (
                    // Phase 8c / CP6b: released behind result PINs. The list
                    // says so in words; the term page has the PIN box.
                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      Result PIN required.{" "}
                      <Link href={`/students/${params.id}/results/${result.termId}`} className="font-medium underline">
                        Enter your PIN
                      </Link>
                    </p>
                  ) : (
                    <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                      <div><dt className="text-muted-foreground">Average</dt><dd>{formatAverage(result.overallAverage)}</dd></div>
                      <div><dt className="text-muted-foreground">Subjects</dt><dd>{result.subjectsCount ?? "—"}</dd></div>
                      <div><dt className="text-muted-foreground">Class</dt><dd>{result.classArmName}</dd></div>
                    </dl>
                  )}
                </article>
              ))}
            </section>
          </Appear>
        ))}
    </main>
  );
}
