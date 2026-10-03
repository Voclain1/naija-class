"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { ReleasedResultDetailDto } from "@school-kit/types";

import { Appear, PageHeader, PageSkeleton } from "@school-kit/ui";

import { PinUnlockForm } from "@/components/pin-unlock-form";
import { ResultCard } from "@/components/result-card";
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
  // Phase 8c / CP6b: released behind result PINs and not yet unlocked.
  | { kind: "locked" }
  | { kind: "loaded"; result: ReleasedResultDetailDto };

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
        if (response.status === 403) {
          const body: unknown = await response.json().catch(() => null);
          if (errorCodeFromBody(body) === "RESULT_LOCKED") {
            if (!cancelled) setState({ kind: "locked" });
            return;
          }
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

      {state.kind === "locked" && (
        <PinUnlockForm
          unlockPath={`/api/portal/students/${params.id}/results/${params.termId}/unlock`}
          onUnlocked={(unlocked) => setState({ kind: "loaded", result: unlocked })}
        />
      )}

      {result && (
        <Appear>
          <ResultCard result={result} />
        </Appear>
      )}
    </main>
  );
}
