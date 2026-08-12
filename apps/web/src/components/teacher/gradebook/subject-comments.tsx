"use client";

import { Check, Loader2, Lock, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AssessmentFeedRowDto, SubjectCommentRowDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  acceptSubjectComment,
  generateSubjectComments,
  listSubjectComments,
} from "@/lib/report-comments/report-comments-api";

// Report-card subject comments — Phase 5 / Slice 3, teacher surface.
//
// Sits under the gradebook grid for the same (arm × subject × term) because
// that is where the teacher already is when comments are due, and the scores
// the comment interprets are on the same screen.
//
// THE APPROVAL GATE IS THE UI'S JOB TOO. A suggestion is never shown as though
// it were already on the report card: it appears in an editable box that is
// visibly NOT saved until "Accept" is pressed. CLAUDE.md's AI hard rule
// requires the gate server-side; presenting a draft as finished would defeat it
// just as thoroughly as skipping it.

interface Props {
  termId: string;
  classArmId: string;
  subjectId: string;
  rows: AssessmentFeedRowDto[];
}

// Poll while a batch is in flight. 6s is slow enough not to hammer the API for
// a job that takes seconds per student, fast enough that comments visibly
// arrive rather than appearing in one lump.
const POLL_MS = 6000;

// Give up after ~5 minutes. A batch generates a few comments a second across
// the worker's concurrency, so anything still missing by then is a failure the
// UI will never be told about directly: jobs fail on the worker, and this slice
// adds no job-status table to read. Without this cap the panel would spin for
// the rest of the session on a mid-batch failure (a 429, a refusal, a worker
// restart) — the same silent-forever state the unconfigured case produced
// before the API learned to refuse the batch up front.
const MAX_POLLS = 50;

function displayName(s: AssessmentFeedRowDto["student"]): string {
  return [s.firstName, s.lastName].filter(Boolean).join(" ");
}

export function SubjectComments({ termId, classArmId, subjectId, rows }: Props) {
  const [comments, setComments] = useState<SubjectCommentRowDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // How many students we are still waiting on. Drives the polling loop.
  const pending = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await listSubjectComments({ termId, classArmId, subjectId });
      setComments(data);
      return data;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load comments.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [termId, classArmId, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while a batch is outstanding — no background traffic on a screen
  // a teacher leaves open all afternoon.
  useEffect(() => {
    if (pending.current <= 0) return;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      void load().then((data) => {
        const withSuggestions = data.filter((r) => r.suggestion !== null).length;
        if (withSuggestions >= pending.current) {
          pending.current = 0;
          setGenerating(false);
          return;
        }
        if (polls >= MAX_POLLS) {
          pending.current = 0;
          setGenerating(false);
          setNotice(
            "Some comments could not be drafted. Press Draft comments again to retry the ones still missing.",
          );
        }
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [generating, load]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await generateSubjectComments({ classArmId, subjectId, termId });
      pending.current = result.queued;

      // Say plainly what was skipped and why. "I pressed generate and six
      // students got nothing" needs an answer on the screen, not in a log.
      const skips: string[] = [];
      if (result.skippedSignedOff > 0) {
        skips.push(`${result.skippedSignedOff} already signed off`);
      }
      if (result.skippedNoScores > 0) {
        skips.push(`${result.skippedNoScores} with no scores yet`);
      }
      setNotice(
        result.queued === 0
          ? `Nothing to draft${skips.length ? ` — ${skips.join(", ")}.` : "."}`
          : `Drafting ${result.queued} comment${result.queued === 1 ? "" : "s"}${
              skips.length ? ` (skipped ${skips.join(", ")})` : ""
            }. They appear below as they finish.`,
      );
      if (result.queued === 0) setGenerating(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start drafting comments.");
      setGenerating(false);
    }
  }

  async function handleAccept(studentId: string, text: string) {
    setSavingId(studentId);
    setError(null);
    try {
      const updated = await acceptSubjectComment({ studentId, subjectId, termId, comment: text });
      setComments((prev) =>
        prev.map((r) => (r.studentId === studentId ? { ...r, comment: updated.comment } : r)),
      );
      setDrafts((d) => {
        const next = { ...d };
        delete next[studentId];
        return next;
      });
      setSavedId(studentId);
      setTimeout(() => setSavedId((s) => (s === studentId ? null : s)), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save that comment.");
    } finally {
      setSavingId(null);
    }
  }

  const byStudent = new Map(comments.map((c) => [c.studentId, c]));

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-medium text-foreground">Report card comments</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drafted from each student&apos;s scores and attendance. Nothing is saved to a report
            card until you accept it.
          </p>
        </div>
        <Button onClick={() => void handleGenerate()} disabled={generating}>
          {generating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Drafting…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Draft comments
            </>
          )}
        </Button>
      </div>

      {notice ? (
        <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">{notice}</p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading comments…
        </div>
      ) : (
        <ul className="flex flex-col divide-y">
          {rows.map((row) => {
            const c = byStudent.get(row.student.id);
            const signedOff = Boolean(c?.signedOffAt);
            const accepted = c?.comment ?? null;
            const suggestion = c?.suggestion ?? null;
            const draft = drafts[row.student.id];
            const value = draft ?? accepted ?? suggestion ?? "";
            const dirty = draft !== undefined && draft !== (accepted ?? "");
            const unaccepted = !accepted && suggestion !== null;

            return (
              <li key={row.student.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-foreground">{displayName(row.student)}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c?.letterGrade ? <span>{c.letterGrade}</span> : null}
                    {c?.totalScore !== null && c?.totalScore !== undefined ? (
                      <span>{c.totalScore}</span>
                    ) : null}
                    {signedOff ? (
                      <span className="flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Signed off
                      </span>
                    ) : null}
                  </span>
                </div>

                {signedOff ? (
                  <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                    {accepted ?? "No comment was recorded before sign-off."}
                  </p>
                ) : (
                  <>
                    <textarea
                      value={value}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [row.student.id]: e.target.value }))
                      }
                      rows={2}
                      maxLength={1000}
                      placeholder={
                        generating ? "Drafting…" : "No draft yet — write one, or press Draft comments."
                      }
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        variant={unaccepted || dirty ? "default" : "secondary"}
                        disabled={
                          savingId === row.student.id || value.trim().length === 0 || (!dirty && !unaccepted)
                        }
                        onClick={() => void handleAccept(row.student.id, value.trim())}
                      >
                        {savingId === row.student.id ? (
                          <>
                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                            Saving
                          </>
                        ) : (
                          "Accept"
                        )}
                      </Button>
                      {savedId === row.student.id ? (
                        <span className="flex items-center gap-1 text-xs text-primary">
                          <Check className="h-3 w-3" />
                          On the report card
                        </span>
                      ) : accepted && !dirty ? (
                        <span className="text-xs text-muted-foreground">On the report card</span>
                      ) : unaccepted ? (
                        <span className="text-xs text-amber-600 dark:text-amber-500">
                          Draft — not saved to the report card yet
                        </span>
                      ) : null}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
