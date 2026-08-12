"use client";

import { BookOpenCheck, FileQuestion, Loader2, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { LessonPlanSummaryDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { createLessonPlan, listLessonPlans } from "@/lib/lesson-plans/lesson-plans-api";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

// /teacher/lesson-plans — Phase 5 / Slice 2.
//
// Two things on one screen: generate a new plan, and open an existing one.
// They are together deliberately — a teacher arriving here almost always wants
// to make one, and a separate "new" route would put a navigation step in front
// of the primary action for no benefit.

// Generation is a real Sonnet call and takes 10-30s. That is far too long for
// a spinner with no explanation: without a sense of progress the honest
// assumption is that the page has hung. These lines cycle so the wait reads as
// work rather than a stall.
const PROGRESS_LINES = [
  "Reading the topic and class level…",
  "Planning the lesson structure…",
  "Writing the teaching content…",
  "Designing activities for a large class…",
  "Preparing assessment questions and homework…",
  "Almost there…",
];

interface Option {
  id: string;
  name: string;
}

export default function LessonPlansPage() {
  const [plans, setPlans] = useState<LessonPlanSummaryDto[]>([]);
  // Sourced from GET /teacher-scope/me, NOT /class-levels + /subjects — those
  // two are owner|admin at the service layer (the Q3a decision: teachers hit
  // only /teacher-scope/*), so calling them 403s for exactly the users this
  // page is built for. Caught in browser verification; a build and a typecheck
  // both passed with the wrong endpoints wired up.
  //
  // Better UX as a side effect: a teacher only picks from the classes and
  // subjects they actually teach, instead of the school's whole catalogue.
  const [levels, setLevels] = useState<Option[]>([]);
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [classLevelId, setClassLevelId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [topic, setTopic] = useState("");
  const [objectives, setObjectives] = useState("");
  const [duration, setDuration] = useState("40");

  const [generating, setGenerating] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, scope] = await Promise.all([listLessonPlans(), getMyScope()]);
      setPlans(p);

      // Distinct class levels across the teacher's arms — several arms
      // (JSS 2 A, JSS 2 B) collapse to one level, which is the grain a lesson
      // plan is written at.
      const levelById = new Map<string, Option>();
      for (const arm of scope.classArms) {
        if (!levelById.has(arm.classLevelId)) {
          levelById.set(arm.classLevelId, { id: arm.classLevelId, name: arm.classLevelName });
        }
      }
      setLevels([...levelById.values()]);

      // Union of the subjects they teach, deduped across arms.
      const subjectById = new Map<string, Option>();
      for (const list of Object.values(scope.subjectsByArm)) {
        for (const s of list) {
          if (!subjectById.has(s.id)) subjectById.set(s.id, { id: s.id, name: s.name });
        }
      }
      setSubjects([...subjectById.values()]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your lesson plans.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Advance the progress copy while a generation is in flight.
  useEffect(() => {
    if (!generating) {
      setProgressIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setProgressIndex((i) => Math.min(i + 1, PROGRESS_LINES.length - 1));
    }, 4000);
    return () => clearInterval(timer);
  }, [generating]);

  const canSubmit = classLevelId && subjectId && topic.trim().length >= 3 && !generating;

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setGenerating(true);
    setFormError(null);
    setGenerated(null);
    try {
      const plan = await createLessonPlan({
        classLevelId,
        subjectId,
        topic: topic.trim(),
        objectives: objectives.trim() ? objectives.trim() : null,
        durationMinutes: duration ? Number(duration) : null,
      });
      setTopic("");
      setObjectives("");
      setGenerated(plan.id);
      await load();
    } catch (e) {
      setFormError(
        e instanceof ApiError ? e.message : "Could not generate the lesson plan. Please try again.",
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
          Lesson plans
        </h1>
        <p className="text-sm text-muted-foreground">
          Give a topic and class, and get a full lesson plan you can edit and teach from.
        </p>
      </header>

      {/* ---------------- Generate ---------------- */}
      <section className="rounded-lg border bg-card p-5 shadow-sm">
        <form onSubmit={handleGenerate} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="classLevel">Class</Label>
              <select
                id="classLevel"
                value={classLevelId}
                onChange={(e) => setClassLevelId(e.target.value)}
                disabled={generating}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <option value="">Select a class…</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subject">Subject</Label>
              <select
                id="subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                disabled={generating}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <option value="">Select a subject…</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="topic">Topic</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Photosynthesis"
              maxLength={200}
              disabled={generating}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="objectives">
                Learning objectives{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <textarea
                id="objectives"
                value={objectives}
                onChange={(e) => setObjectives(e.target.value)}
                placeholder="Leave blank and appropriate objectives will be suggested for the class level."
                rows={2}
                maxLength={2000}
                disabled={generating}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
            </div>
            <div className="flex w-full flex-col gap-1.5 sm:w-28">
              <Label htmlFor="duration">Minutes</Label>
              <Input
                id="duration"
                type="number"
                min={5}
                max={240}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={generating}
              />
            </div>
          </div>

          {formError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!canSubmit}>
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate lesson plan
                </>
              )}
            </Button>
            {generating ? (
              <span className="text-sm text-muted-foreground">{PROGRESS_LINES[progressIndex]}</span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Takes up to a minute. You can edit everything afterwards.
              </span>
            )}
          </div>
        </form>
      </section>

      {/* ---------------- Existing plans ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-medium text-foreground">Your lesson plans</h2>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No lesson plans yet.</p>
            <p className="mt-1">Generate your first one above — it takes about a minute.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {plans.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/teacher/lesson-plans/${p.id}`}
                  className={`flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/40 ${
                    generated === p.id ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-medium text-foreground">{p.topic}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.classLevelName} · {p.subjectName}
                      {p.durationMinutes ? ` · ${p.durationMinutes} min` : ""}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.hasQuiz ? (
                      <Badge variant="secondary" className="gap-1">
                        <FileQuestion className="h-3 w-3" />
                        Quiz
                      </Badge>
                    ) : null}
                    {p.status === "ACCEPTED" ? (
                      <Badge className="gap-1">
                        <BookOpenCheck className="h-3 w-3" />
                        Ready
                      </Badge>
                    ) : (
                      <Badge variant="outline">Draft</Badge>
                    )}
                    {!p.hasContent ? (
                      <Badge variant="destructive" title="Generation did not finish">
                        Incomplete
                      </Badge>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Plus className="h-3 w-3" />
        Lesson plans are yours to edit. Nothing is shared with students or parents.
      </p>
    </div>
  );
}
