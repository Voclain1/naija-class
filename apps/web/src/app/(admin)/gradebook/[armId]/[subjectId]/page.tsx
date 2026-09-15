"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { AssessmentFeedResponse, GradingSchemeDto, TermDto } from "@school-kit/types";

import { GradebookGrid } from "@/components/teacher/gradebook/gradebook-grid";
import { SubjectComments } from "@/components/teacher/gradebook/subject-comments";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { getGradebookFeed } from "@/lib/assessment/assessment-api";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { defaultGradebookTerm } from "@/lib/gradebook/admin-gradebook";
import { getGradingScheme } from "@/lib/grading/grading-api";
import { listSubjects } from "@/lib/subjects/subjects-api";

interface Loaded {
  armName: string;
  subjectName: string;
  term: TermDto;
  scheme: GradingSchemeDto;
  feed: AssessmentFeedResponse;
}

type Status =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "not-found" }
  | { kind: "no-term" }
  | { kind: "ready"; data: Loaded };

// /gradebook/[armId]/[subjectId]?termId= — the owner/admin grid for one class
// and subject.
//
// The same GradebookGrid and SubjectComments the teacher uses, against the same
// endpoints, so saving, sign-off, the released-card lock and the audit rows are
// identical. The API is where authority lives: it accepts owner and admin for
// every one of these calls without teacher scope (assessment.service.ts
// isTeacherScoped, aggregation.service.ts assertCanAggregate,
// report-comments.service.ts assertSubjectInScope). Scores keyed here are
// recorded as entered by this user, never by the class's teacher.
//
// "Recompute positions" is always offered: owner and admin may aggregate any
// class, where a teacher may only for a class they form-teach.
export default function AdminGradebookGridPage() {
  const params = useParams<{ armId: string; subjectId: string }>();
  const search = useSearchParams();
  const { armId, subjectId } = params;
  const requestedTermId = search.get("termId");
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  const load = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      const [years, arms, subjects, scheme] = await Promise.all([
        listAcademicYears(),
        listClassArms({ includeInactive: true }),
        listSubjects({ includeInactive: true }),
        getGradingScheme(),
      ]);
      const arm = arms.find((a) => a.id === armId);
      const subject = subjects.find((s) => s.id === subjectId);
      if (!arm || !subject) {
        setStatus({ kind: "not-found" });
        return;
      }

      // Resolve the term against the school's own terms — never trust the query
      // string's id without finding it here first.
      const terms = (await Promise.all(years.map((y) => listTerms(y.id)))).flat();
      const currentYear = years.find((y) => y.isCurrent) ?? years[0];
      const term = requestedTermId
        ? terms.find((t) => t.id === requestedTermId)
        : defaultGradebookTerm(terms.filter((t) => t.academicYearId === currentYear?.id));
      if (!term) {
        setStatus(requestedTermId ? { kind: "not-found" } : { kind: "no-term" });
        return;
      }

      const feed = await getGradebookFeed(term.id, armId, subjectId);
      setStatus({
        kind: "ready",
        data: { armName: arm.name, subjectName: subject.name, term, scheme, feed },
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setStatus({ kind: "not-found" });
        return;
      }
      setStatus({
        kind: "error",
        message: e instanceof ApiError ? e.message : "Could not load the gradebook.",
      });
    }
  }, [armId, subjectId, requestedTermId]);

  useEffect(() => {
    void load();
  }, [load]);

  const termForBack = status.kind === "ready" ? status.data.term.id : requestedTermId;
  const backHref = `/gradebook?${new URLSearchParams({
    armId,
    ...(termForBack ? { termId: termForBack } : {}),
  }).toString()}`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        All subjects
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
      ) : status.kind === "not-found" ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">This class, subject or term was not found.</p>
          <p className="mt-1">Go back and pick a class and subject from the list.</p>
        </div>
      ) : status.kind === "no-term" ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-8 text-sm text-amber-800">
          <p className="font-medium">No terms yet.</p>
          <p className="mt-1">Add the academic year and its terms under Academics before entering scores.</p>
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
              {status.data.subjectName} — {status.data.armName}
            </h1>
            <p className="text-sm text-muted-foreground">{status.data.term.name}</p>
          </header>

          {status.data.feed.data.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No students enrolled.</p>
              <p className="mt-1">
                No students are enrolled in this class for {status.data.term.name}. Enroll them under{" "}
                <Link href="/enrollments" className="font-medium underline">
                  Enrollments
                </Link>
                .
              </p>
            </div>
          ) : status.data.scheme.components.length === 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              The grading scheme has no components. Set it up under{" "}
              <Link href="/settings/grading" className="font-medium underline">
                Grading
              </Link>
              .
            </div>
          ) : (
            <>
              <GradebookGrid
                scheme={status.data.scheme}
                initialFeed={status.data.feed}
                termId={status.data.term.id}
                classArmId={armId}
                subjectId={subjectId}
                canAggregate
              />
              <SubjectComments
                termId={status.data.term.id}
                classArmId={armId}
                subjectId={subjectId}
                rows={status.data.feed.data}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
