"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type {
  AssessmentFeedResponse,
  GradingSchemeDto,
  TeacherCurrentTermDto,
} from "@school-kit/types";

import { GradebookGrid } from "@/components/teacher/gradebook/gradebook-grid";
import { ApiError } from "@/lib/api-client";
import { getGradebookFeed } from "@/lib/assessment/assessment-api";
import { getGradingScheme } from "@/lib/grading/grading-api";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

interface Loaded {
  armName: string;
  subjectName: string;
  term: TeacherCurrentTermDto;
  scheme: GradingSchemeDto;
  feed: AssessmentFeedResponse;
}

type Status =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "out-of-scope" }
  | { kind: "no-term" }
  | { kind: "ready"; data: Loaded };

// /teacher/gradebook/[armId]/[subjectId] — the grid for one (arm × subject) in
// the current term. Resolves the term + scope + scheme + feed, then hands the
// data to GradebookGrid. All authorization is server-side (the feed 404s an
// out-of-scope column); we additionally pre-check scope here for clean
// arm/subject names and a friendlier message.
export default function GradebookGridPage() {
  const params = useParams<{ armId: string; subjectId: string }>();
  const armId = params.armId;
  const subjectId = params.subjectId;
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  const load = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      const [scope, scheme] = await Promise.all([getMyScope(), getGradingScheme()]);

      const arm = scope.classArms.find((a) => a.id === armId);
      const subject = (scope.subjectsByArm[armId] ?? []).find((s) => s.id === subjectId);
      if (!arm || !subject) {
        setStatus({ kind: "out-of-scope" });
        return;
      }
      if (!scope.currentTerm) {
        setStatus({ kind: "no-term" });
        return;
      }

      const feed = await getGradebookFeed(scope.currentTerm.id, armId, subjectId);
      setStatus({
        kind: "ready",
        data: { armName: arm.name, subjectName: subject.name, term: scope.currentTerm, scheme, feed },
      });
    } catch (e) {
      // A 404 from the feed means the column isn't in this teacher's scope.
      if (e instanceof ApiError && e.status === 404) {
        setStatus({ kind: "out-of-scope" });
        return;
      }
      setStatus({
        kind: "error",
        message: e instanceof ApiError ? e.message : "Could not load the gradebook.",
      });
    }
  }, [armId, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Link
        href="/teacher/gradebook"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All classes
      </Link>

      {status.kind === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : status.kind === "error" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {status.message}
        </div>
      ) : status.kind === "out-of-scope" ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">This isn&apos;t one of your classes.</p>
          <p className="mt-1">You can only enter scores for the subjects you&apos;re assigned to.</p>
        </div>
      ) : status.kind === "no-term" ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-8 text-sm text-amber-800">
          <p className="font-medium">No active term.</p>
          <p className="mt-1">Ask an administrator to set the current term before entering scores.</p>
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {status.data.subjectName} — {status.data.armName}
            </h1>
            <p className="text-sm text-muted-foreground">{status.data.term.name}</p>
          </header>

          {status.data.feed.data.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No students enrolled.</p>
              <p className="mt-1">
                No students are enrolled in this class for {status.data.term.name}.
              </p>
            </div>
          ) : status.data.scheme.components.length === 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              The grading scheme has no components. Ask an administrator to set it up under Settings →
              Grading.
            </div>
          ) : (
            <GradebookGrid scheme={status.data.scheme} feed={status.data.feed} />
          )}
        </>
      )}
    </div>
  );
}
