"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  ASSIGNMENT_LIMITS,
  describeWorkStatus,
  type AssignmentMarkingDto,
  type AssignmentRosterRowDto,
  type AssignmentSubmissionDto,
  type StudentWorkDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { openPrivateDocument } from "@/components/health/vaccinations-section";
import {
  collectWork,
  getAssignmentFileUrl,
  getMarking,
  getStudentWork,
  markSubmission,
  releaseMarks,
  returnSubmission,
} from "@/lib/assignments/assignments-api";

// Phase 9 / CP4.1 — the marking page for one homework item that collects work
// (docs/modules/phase-9.md §11). The class's teachers, owner and admin. Marks
// reach the student and parents only after "Release marks" (CP4-D7). The paste
// figure (Q7) is shown here and nowhere a family can see it.

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatMoment(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

const STATUS_STYLE: Record<AssignmentRosterRowDto["status"], string> = {
  NOT_SUBMITTED: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-primary/10 text-foreground",
  RETURNED: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  MARKED: "bg-secondary/20 text-foreground",
};

function Attempt({
  attempt,
  latest,
  totalMarks,
  onChanged,
}: {
  attempt: AssignmentSubmissionDto;
  latest: boolean;
  totalMarks: number;
  onChanged: (work: StudentWorkDto) => void;
}) {
  const [mark, setMark] = useState(attempt.mark === null ? "" : String(attempt.mark));
  const [feedback, setFeedback] = useState(attempt.feedback ?? "");
  const [note, setNote] = useState("");
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWork = latest && !attempt.returnedAt;

  async function run(fn: () => Promise<StudentWorkDto>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
      setReturning(false);
    } catch (e) {
      setError(message(e, "That did not work. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-md border bg-card p-3">
      <header className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-medium">Attempt {attempt.attempt}</span>
        <span className="text-muted-foreground">handed in {formatMoment(attempt.submittedAt)}</span>
        {attempt.late && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            Late
          </span>
        )}
      </header>
      {attempt.body && (
        <>
          <p className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-sm">{attempt.body}</p>
          <p className="text-xs text-muted-foreground">
            About {attempt.pastedPercent}% of this answer was pasted rather than typed, as the student&apos;s device
            reported it. A fact about how the text arrived, not a judgement; it does not affect the mark, and the student
            and parents never see it.
          </p>
        </>
      )}
      {attempt.files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attempt.files.map((f, i) => (
            <Button
              key={f.id}
              size="sm"
              variant="outline"
              onClick={() =>
                void openPrivateDocument(() => getAssignmentFileUrl(f.id)).catch((e) =>
                  setError(message(e, "Could not open the file.")),
                )
              }
            >
              View {f.type === "pdf" ? "PDF" : "photo"} {attempt.files.length > 1 ? i + 1 : ""}
            </Button>
          ))}
        </div>
      )}
      {attempt.returnedAt && (
        <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          Returned {formatMoment(attempt.returnedAt)}: {attempt.returnNote}
        </p>
      )}
      {canWork && (
        <form
          className="flex flex-col gap-2"
          aria-label={`Mark attempt ${attempt.attempt}`}
          onSubmit={(e) => {
            e.preventDefault();
            const value = Number(mark);
            if (mark.trim() === "" || !Number.isInteger(value)) {
              setError("Enter a whole-number mark.");
              return;
            }
            void run(() => markSubmission(attempt.id, { mark: value, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) }));
          }}
        >
          <label className="flex w-40 flex-col gap-1 text-sm">
            <span className="font-medium">Mark out of {totalMarks}</span>
            <input
              inputMode="numeric"
              value={mark}
              onChange={(e) => setMark(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Feedback</span>
            <textarea
              rows={3}
              maxLength={ASSIGNMENT_LIMITS.feedback}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="rounded-md border border-input bg-background p-3 text-sm"
            />
          </label>
          {attempt.markedAt && (
            <p className="text-xs text-muted-foreground">
              Marked {attempt.mark}/{totalMarks}
              {attempt.markedByName ? ` by ${attempt.markedByName}` : ""}.{" "}
              {attempt.releasedAt ? "Released to the student and parents." : "Not released yet."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {attempt.markedAt ? "Update mark" : "Save mark"}
            </Button>
            {!attempt.markedAt && !returning && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReturning(true)}>
                Return to student
              </Button>
            )}
          </div>
        </form>
      )}
      {canWork && returning && (
        <form
          className="flex flex-col gap-2"
          aria-label="Return to student"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => returnSubmission(attempt.id, { note: note.trim() }));
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">What should the student change?</span>
            <textarea
              rows={2}
              maxLength={ASSIGNMENT_LIMITS.returnNote}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-md border border-input bg-background p-3 text-sm"
              required
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || note.trim() === ""}>
              Return work
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReturning(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
    </article>
  );
}

function StudentPanel({
  homeworkId,
  row,
  onChanged,
}: {
  homeworkId: string;
  row: AssignmentRosterRowDto;
  onChanged: () => void;
}) {
  const [work, setWork] = useState<StudentWorkDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStudentWork(homeworkId, row.studentId)
      .then((w) => !cancelled && setWork(w))
      .catch((e) => !cancelled && setError(message(e, "Could not load the work.")));
    return () => {
      cancelled = true;
    };
  }, [homeworkId, row.studentId]);

  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!work) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (work.attempts.length === 0) return <p className="text-sm text-muted-foreground">Nothing handed in yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      {work.attempts.map((a, i) => (
        <Attempt
          key={a.id}
          attempt={a}
          latest={i === 0}
          totalMarks={work.totalMarks}
          onChanged={(next) => {
            setWork(next);
            onChanged();
          }}
        />
      ))}
    </div>
  );
}

export function MarkingView({ homeworkId, backHref, backLabel }: { homeworkId: string; backHref: string; backLabel: string }) {
  const [data, setData] = useState<AssignmentMarkingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getMarking(homeworkId);
      setData(next);
      setTotal(String(next.collection.totalMarks));
    } catch (e) {
      setError(message(e, "Could not load the handed-in work."));
    }
  }, [homeworkId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<AssignmentMarkingDto>) {
    setBusy(true);
    setActionError(null);
    try {
      const next = await fn();
      setData(next);
      setTotal(String(next.collection.totalMarks));
    } catch (e) {
      setActionError(message(e, "That did not work. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }

  const unreleased = data.roster.filter((r) => r.status === "MARKED" && !r.released).length;

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <div>
        <Link href={backHref} className="text-sm text-primary hover:underline">
          ← {backLabel}
        </Link>
      </div>
      <header className="flex flex-col gap-1">
        <h1 className="break-words font-serif text-2xl font-medium tracking-tight text-foreground">{data.title}</h1>
        <p className="text-sm text-muted-foreground">
          {data.className} · {data.subjectName} · due {formatDay(data.dueDate)}
        </p>
        <p className="text-sm">
          {data.counts.submitted} to mark · {data.counts.marked} marked · {data.counts.released} released ·{" "}
          {data.counts.notSubmitted} not handed in
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-label="Settings">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = Number(total);
            if (!Number.isInteger(value) || value < 1) {
              setActionError("Enter a whole-number total.");
              return;
            }
            void act(() => collectWork(homeworkId, { totalMarks: value }));
          }}
        >
          <label className="flex w-36 flex-col gap-1 text-sm">
            <span className="font-medium">Total marks</span>
            <input
              inputMode="numeric"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={busy || total === String(data.collection.totalMarks)}>
            Change total
          </Button>
        </form>
        <p className="text-sm">
          {data.collection.accepting
            ? "Students can hand work in, late work included."
            : "Not accepting new work. Work you returned can still come back."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(() => collectWork(homeworkId, { totalMarks: data.collection.totalMarks, accepting: !data.collection.accepting }))
            }
          >
            {data.collection.accepting ? "Stop accepting work" : "Accept work again"}
          </Button>
          <Button
            size="sm"
            disabled={busy || unreleased === 0}
            onClick={() => {
              if (window.confirm(`Release ${unreleased} mark${unreleased === 1 ? "" : "s"}?\n\nThe students and their parents will see the mark and your feedback.`)) {
                void act(() => releaseMarks(homeworkId));
              }
            }}
          >
            {unreleased === 0 ? "No new marks to release" : `Release ${unreleased} mark${unreleased === 1 ? "" : "s"}`}
          </Button>
        </div>
        {actionError && <InlineAlert>{actionError}</InlineAlert>}
      </section>

      <ul className="flex flex-col gap-2">
        {data.roster.map((row) => (
          <li key={row.studentId} className="rounded-lg border bg-card">
            <button
              type="button"
              aria-expanded={open === row.studentId}
              onClick={() => setOpen(open === row.studentId ? null : row.studentId)}
              className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left"
            >
              <span className="min-w-0">
                <span className="block break-words font-medium">{row.name}</span>
                <span className="block text-xs text-muted-foreground">{row.admissionNumber}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1 text-xs">
                <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[row.status]}`}>{describeWorkStatus(row.status)}</span>
                {row.late && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">Late</span>}
                {row.mark !== null && (
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {row.mark}/{data.collection.totalMarks}
                    {row.released ? " · released" : ""}
                  </span>
                )}
                {row.attempts > 1 && <span className="rounded bg-muted px-1.5 py-0.5">{row.attempts} attempts</span>}
                {row.fileCount > 0 && (
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {row.fileCount} file{row.fileCount === 1 ? "" : "s"}
                  </span>
                )}
              </span>
            </button>
            {open === row.studentId && (
              <div className="border-t p-3">
                <StudentPanel homeworkId={homeworkId} row={row} onChanged={() => void load()} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
