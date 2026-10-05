"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CbtPackCandidate } from "@school-kit/types";

import {
  addExtraTime,
  answeredCount,
  choose,
  formatClock,
  goTo,
  noteFocusLoss,
  questionsFor,
  remainingMs,
  submit,
  type LocalAttempt,
} from "@/lib/attempt";
import { optionLetter } from "@/lib/format";
import { saveAttempt } from "@/lib/store";
import { describeSync, syncSitting, type SyncState } from "@/lib/sync";

import { InvigilatorCode, type OpenedPack } from "./before-exam";
import { Button } from "./ui";

// The exam itself (docs/modules/cbt.md D6, D7). Every choice is saved on this
// machine before anything else happens; answers go to the school every 30
// seconds when the internet is up. The clock is wall time from the start.
// Leaving the exam window is counted; copying and pasting are off.

const SYNC_EVERY_MS = 30_000;
const WARN_AT_MS = 5 * 60_000;

export function ExamScreen({
  opened,
  candidate,
  initial,
  onDone,
}: {
  opened: OpenedPack;
  candidate: CbtPackCandidate;
  initial: LocalAttempt;
  onDone: (attempt: LocalAttempt, timeUp: boolean) => void;
}) {
  const { pack, payload, key } = opened;
  const env = pack.envelope;
  const questions = useMemo(() => questionsFor(payload, initial.version), [payload, initial.version]);
  const [attempt, setAttempt] = useState(initial);
  const latest = useRef(initial);
  const [now, setNow] = useState(() => new Date());
  const [sync, setSync] = useState<SyncState | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [invigilator, setInvigilator] = useState<"closed" | "code" | "open">("closed");
  const finishing = useRef(false);

  // Saved on this machine first, every time; the screen follows.
  const persist = useCallback(async (next: LocalAttempt) => {
    if (next === latest.current) return;
    latest.current = next;
    setAttempt(next);
    try {
      await saveAttempt(next);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, []);

  const runSync = useCallback(async () => setSync(await syncSitting(pack.slug, pack.sittingId, key)), [pack.slug, pack.sittingId, key]);

  const finish = useCallback(
    async (timeUp: boolean) => {
      if (finishing.current) return;
      finishing.current = true;
      const done = submit(latest.current, new Date());
      await persist(done);
      void runSync();
      onDone(done, timeUp);
    },
    [persist, runSync, onDone],
  );

  // The clock.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = remainingMs(attempt, env.durationMinutes, now);
  useEffect(() => {
    if (left === 0) void finish(true);
  }, [left, finish]);

  // Sending: now (so the school sees the start), every 30 s, and on reconnect.
  useEffect(() => {
    void runSync();
    const timer = setInterval(() => void runSync(), SYNC_EVERY_MS);
    const online = () => void runSync();
    window.addEventListener("online", online);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [runSync]);

  // Leaving the exam (another window, another tab, minimised) counts once
  // per leave, however many events the browser fires for it.
  useEffect(() => {
    let away = false;
    const leave = () => {
      if (away || finishing.current) return;
      away = true;
      void persist(noteFocusLoss(latest.current));
    };
    const back = () => {
      away = false;
    };
    const visibility = () => (document.visibilityState === "hidden" ? leave() : back());
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [persist]);

  const index = Math.min(attempt.current, Math.max(0, questions.length - 1));
  const question = questions[index];
  const answered = answeredCount(attempt);
  const block = (e: React.SyntheticEvent) => e.preventDefault();

  if (!question) {
    return <p className="p-6">This exam has no questions for your version. Tell the invigilator.</p>;
  }

  return (
    <div className="exam-no-select flex min-h-screen flex-col" onCopy={block} onCut={block} onPaste={block} onContextMenu={block}>
      <header className={`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-sm ${left <= WARN_AT_MS ? "bg-amber-100" : "bg-card"}`}>
        <div className="min-w-0">
          <p className="truncate font-medium">{env.title}</p>
          <p className="text-sm text-muted-foreground">
            {candidate.displayName} · {candidate.armName}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl tabular-nums" aria-label="Time left" role="timer">
            {formatClock(left)}
          </p>
          {left <= WARN_AT_MS ? <p className="text-sm font-medium text-amber-900">Less than 5 minutes left</p> : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 lg:flex-row">
        <main className="flex flex-1 flex-col gap-5">
          {index === 0 || questions[index - 1]?.sectionTitle !== question.sectionTitle ? (
            <div className="rounded-md bg-muted/40 p-3">
              <p className="font-medium">{question.sectionTitle}</p>
              {question.sectionInstructions ? <p className="whitespace-pre-wrap text-sm">{question.sectionInstructions}</p> : null}
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 flex w-full items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                Question {index + 1} of {questions.length}
              </span>
              <span className="text-sm text-muted-foreground">
                {question.marks} mark{question.marks === 1 ? "" : "s"}
              </span>
            </legend>
            <p className="whitespace-pre-wrap text-xl leading-relaxed">{question.text}</p>
            <div className="flex flex-col gap-2">
              {question.options.map((option, i) => {
                const picked = attempt.answers[question.itemId] === option.id;
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-md p-4 text-lg transition-colors ${picked ? "bg-primary/15 ring-2 ring-primary" : "bg-card ring-1 ring-border hover:bg-muted"}`}
                  >
                    <input
                      type="radio"
                      name={`q-${question.itemId}`}
                      className="mt-1.5 h-5 w-5 accent-[hsl(var(--primary))]"
                      checked={picked}
                      onChange={() => void persist(choose(latest.current, question.itemId, option.id))}
                    />
                    <span className="font-medium">{optionLetter(i)}.</span>
                    <span className="whitespace-pre-wrap">{option.text}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={index === 0} onClick={() => void persist(goTo(latest.current, index - 1))}>
              Previous
            </Button>
            {index < questions.length - 1 ? (
              <Button onClick={() => void persist(goTo(latest.current, index + 1))}>Next</Button>
            ) : null}
            <Button variant={index === questions.length - 1 ? "primary" : "outline"} className="ml-auto" onClick={() => setConfirming(true)}>
              Finish exam
            </Button>
          </div>

          {confirming ? (
            <div className="flex flex-col gap-3 rounded-lg bg-amber-50 p-5" role="alertdialog" aria-labelledby="finish-heading">
              <p id="finish-heading" className="text-lg font-medium">
                Finish the exam?
              </p>
              <p>
                You have answered {answered} of {questions.length} questions.
                {answered < questions.length ? ` ${questions.length - answered} not answered.` : ""} Once you finish, you cannot change
                your answers.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => void finish(false)}>Yes, finish</Button>
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  Go back
                </Button>
              </div>
            </div>
          ) : null}
        </main>

        <aside className="flex w-full flex-col gap-4 lg:w-64">
          <nav aria-label="Questions" className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {answered} of {questions.length} answered
            </p>
            <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">
              {questions.map((q, i) => {
                const done = Boolean(attempt.answers[q.itemId]);
                return (
                  <button
                    key={q.itemId}
                    type="button"
                    aria-label={`Question ${i + 1}${done ? ", answered" : ""}`}
                    aria-current={i === index ? "step" : undefined}
                    onClick={() => void persist(goTo(latest.current, i))}
                    className={`h-9 rounded text-sm tabular-nums ${i === index ? "ring-2 ring-foreground" : ""} ${done ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </nav>

          <p className="text-xs text-muted-foreground" aria-live="polite">
            {saveError ? (
              <span className="text-destructive">Could not save on this computer. Tell the invigilator.</span>
            ) : (
              <>Saved on this computer. {describeSync(sync)}</>
            )}
          </p>

          <div className="text-sm">
            {invigilator === "closed" ? (
              <button type="button" className="text-muted-foreground underline" onClick={() => setInvigilator("code")}>
                Invigilator
              </button>
            ) : invigilator === "code" ? (
              <div className="flex flex-col gap-2">
                <InvigilatorCode opened={opened} label="Continue" onConfirmed={() => setInvigilator("open")} />
                <button type="button" className="self-start text-muted-foreground underline" onClick={() => setInvigilator("closed")}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
                <p>Add time for this student{attempt.extraMinutes ? ` (already +${attempt.extraMinutes} min)` : ""}:</p>
                <div className="flex gap-2">
                  {[5, 10, 15].map((m) => (
                    <Button key={m} variant="outline" className="h-9 px-3 text-sm" onClick={() => void persist(addExtraTime(latest.current, m))}>
                      +{m} min
                    </Button>
                  ))}
                </div>
                <button type="button" className="self-start text-muted-foreground underline" onClick={() => setInvigilator("closed")}>
                  Close
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
