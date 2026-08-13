"use client";

import { Check, Loader2, Lock, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FormCommentRowDto, ReportCardBoardRowDto } from "@school-kit/types";


import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { fullStudentName } from "@/lib/report-cards/format";
import { updateFormTeacherComment } from "@/lib/report-cards/report-card-api";
import { generateFormComments, listFormComments } from "@/lib/report-comments/report-comments-api";

// Form teacher's report-card comments — Phase 5 / Slice 4, teacher/admin surface.
//
// Sits under the arm's report-card board, which is where the form teacher
// already is when comments are due and where every card's status is visible.
//
// ACCEPT GOES THROUGH THE EXISTING ENDPOINT. `updateFormTeacherComment` is the
// Phase 2 PATCH /report-cards/:id call, with its own auth, DRAFT/SUBJECT_REVIEWED
// gate and audit row. This panel drafts and reviews; it never invented a second
// write path, which is why there is no accept call in the AI client.
//
// The draft is shown as visibly unsaved until accepted, same as the subject
// comment panel: presenting AI output as though it were already on the report
// card would defeat the approval gate as thoroughly as skipping it.

interface Props {
  termId: string;
  classArmId: string;
  rows: ReportCardBoardRowDto[];
  // Called after an accept so the board's own copy of the card refreshes.
  onAccepted?: () => void;
}

const POLL_MS = 6000;
// ~5 minutes, then stop. Jobs fail on the worker and this slice adds no
// job-status table, so without a cap the panel would spin for the rest of the
// session on a mid-batch failure — the bug slice 3's browser pass surfaced.
const MAX_POLLS = 50;

export function FormComments({ termId, classArmId, rows, onAccepted }: Props) {
  const [comments, setComments] = useState<FormCommentRowDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await listFormComments({ classArmId, termId });
      setComments(data);
      return data;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load form teacher comments.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [classArmId, termId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pending.current <= 0) return;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      void load().then((data) => {
        const done = data.filter((r) => r.suggestion !== null).length;
        if (done >= pending.current) {
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
      const result = await generateFormComments({ classArmId, termId });
      pending.current = result.queued;

      const skips: string[] = [];
      if (result.skippedLocked > 0) skips.push(`${result.skippedLocked} already reviewed or released`);
      if (result.skippedNoResults > 0) skips.push(`${result.skippedNoResults} with no results yet`);
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

  async function handleAccept(reportCardId: string, text: string) {
    setSavingId(reportCardId);
    setError(null);
    try {
      await updateFormTeacherComment(reportCardId, text);
      setComments((prev) =>
        prev.map((r) => (r.reportCardId === reportCardId ? { ...r, comment: text } : r)),
      );
      setDrafts((d) => {
        const next = { ...d };
        delete next[reportCardId];
        return next;
      });
      setSavedId(reportCardId);
      setTimeout(() => setSavedId((s) => (s === reportCardId ? null : s)), 2000);
      onAccepted?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save that comment.");
    } finally {
      setSavingId(null);
    }
  }

  const byStudent = new Map(comments.map((c) => [c.studentId, c]));

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-5 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-medium text-foreground">Form teacher comments</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drafted from each student&apos;s results across every subject, plus attendance. Nothing
            reaches a report card until you accept it.
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
            if (!c) return null;
            const draft = drafts[c.reportCardId];
            const value = draft ?? c.comment ?? c.suggestion ?? "";
            const dirty = draft !== undefined && draft !== (c.comment ?? "");
            const unaccepted = !c.comment && c.suggestion !== null;

            return (
              <li key={row.student.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-foreground">{fullStudentName(row.student)}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c.overallAverage !== null ? <span>{c.overallAverage}%</span> : null}
                    {!c.editable ? (
                      <span className="flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Locked
                      </span>
                    ) : null}
                  </span>
                </div>

                {!c.editable ? (
                  <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                    {c.comment ?? "No comment was recorded before this card was reviewed."}
                  </p>
                ) : (
                  <>
                    <textarea
                      value={value}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [c.reportCardId]: e.target.value }))
                      }
                      rows={3}
                      maxLength={2000}
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
                          savingId === c.reportCardId ||
                          value.trim().length === 0 ||
                          (!dirty && !unaccepted)
                        }
                        onClick={() => void handleAccept(c.reportCardId, value.trim())}
                      >
                        {savingId === c.reportCardId ? (
                          <>
                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                            Saving
                          </>
                        ) : (
                          "Accept"
                        )}
                      </Button>
                      {savedId === c.reportCardId ? (
                        <span className="flex items-center gap-1 text-xs text-primary">
                          <Check className="h-3 w-3" />
                          On the report card
                        </span>
                      ) : c.comment && !dirty ? (
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
