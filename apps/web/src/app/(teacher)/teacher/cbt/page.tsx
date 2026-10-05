"use client";

import { Loader2, MonitorCheck, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { CbtSchedulablePaperDto, CbtSittingSummaryDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { createCbtSitting, listCbtSittings, listSchedulablePapers } from "@/lib/cbt/cbt-api";
import { cbtStatusLabel, describeSittingTime, localMoment } from "@/lib/cbt/cbt-format";

// /teacher/cbt — online exams (docs/modules/cbt.md). The school's sittings,
// and a form to schedule one from a FINAL paper. Only multiple-choice
// questions are sat online; theory stays on paper (decision Q2).

const SELECT =
  "h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export default function CbtSittingsPage() {
  const router = useRouter();
  const [sittings, setSittings] = useState<CbtSittingSummaryDto[] | null>(null);
  const [papers, setPapers] = useState<CbtSchedulablePaperDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [paperId, setPaperId] = useState("");
  const [title, setTitle] = useState("");
  const [armIds, setArmIds] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [latestStart, setLatestStart] = useState("09:30");
  const [duration, setDuration] = useState("40");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    listCbtSittings()
      .then(setSittings)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load online exams."));
    // Only staff who can schedule get papers; a 403 just hides the form.
    listSchedulablePapers()
      .then(setPapers)
      .catch(() => setPapers([]));
  }, []);

  const paper = useMemo(() => papers?.find((p) => p.id === paperId) ?? null, [papers, paperId]);

  function choosePaper(id: string) {
    setPaperId(id);
    const p = papers?.find((x) => x.id === id);
    setTitle(p ? p.title : "");
    setArmIds(p ? p.arms.map((a) => a.id) : []);
    if (p) setDuration(String(Math.min(p.durationMinutes, 600)));
  }

  const durationOk = /^\d+$/.test(duration) && Number(duration) >= 5 && Number(duration) <= 600;
  const startsAt = date && startTime ? localMoment(date, startTime) : null;
  const windowEndsAt = date && latestStart ? localMoment(date, latestStart) : null;
  const windowOk = Boolean(startsAt && windowEndsAt && windowEndsAt > startsAt);
  const canSave = Boolean(paper && title.trim() && armIds.length > 0 && durationOk && windowOk && !saving);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!paper || !startsAt || !windowEndsAt) return;
    setSaving(true);
    setFormError(null);
    try {
      const created = await createCbtSitting({
        paperId: paper.id,
        title: title.trim(),
        classArmIds: armIds,
        startsAt: startsAt.toISOString(),
        windowEndsAt: windowEndsAt.toISOString(),
        durationMinutes: Number(duration),
      });
      router.push(`/teacher/cbt/${created.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not schedule the exam. Try again.");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Online exams</h1>
        <p className="text-sm text-muted-foreground">
          Students sit a final exam paper on the school&apos;s computers. The multiple-choice questions are marked automatically;
          theory questions stay on paper.
        </p>
      </header>

      {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

      {papers && papers.length > 0 ? (
        <section className="rounded-lg border bg-card p-5 shadow-sm" aria-labelledby="schedule-heading">
          <h2 id="schedule-heading" className="mb-3 font-medium">
            Schedule an online exam
          </h2>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cbt-paper">Exam paper</Label>
              <select id="cbt-paper" value={paperId} onChange={(e) => choosePaper(e.target.value)} className={SELECT}>
                <option value="">Choose a final paper…</option>
                {papers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} — {p.classLevelName} {p.subjectName}, {p.termName}
                  </option>
                ))}
              </select>
              {paper ? (
                <p className="text-xs text-muted-foreground">
                  {paper.objectiveQuestionCount} multiple-choice question{paper.objectiveQuestionCount === 1 ? "" : "s"} ({paper.objectiveTotal}{" "}
                  marks) will be sat online.
                  {paper.onPaperQuestionCount === 1
                    ? " 1 other question stays on paper."
                    : paper.onPaperQuestionCount > 1
                      ? ` ${paper.onPaperQuestionCount} other questions stay on paper.`
                      : ""}
                </p>
              ) : null}
            </div>

            {paper ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cbt-title">Title</Label>
                  <Input id="cbt-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                </div>

                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">Classes</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {paper.arms.map((arm) => (
                      <label key={arm.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={armIds.includes(arm.id)}
                          onChange={(e) =>
                            setArmIds((ids) => (e.target.checked ? [...ids, arm.id] : ids.filter((x) => x !== arm.id)))
                          }
                        />
                        {arm.name}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cbt-date">Date</Label>
                    <Input id="cbt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cbt-start">Starts at</Label>
                    <Input id="cbt-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cbt-latest">Latest start</Label>
                    <Input id="cbt-latest" type="time" value={latestStart} onChange={(e) => setLatestStart(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cbt-duration">Length (minutes)</Label>
                    <Input id="cbt-duration" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  A student may begin any time between the start and the latest start, and then has the full length. Times are in
                  this computer&apos;s time zone.
                </p>
                {date && !windowOk ? <p className="text-sm text-destructive">The latest start must be after the start.</p> : null}
                {formError ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{formError}</p> : null}
                <Button type="submit" className="self-start" disabled={!canSave}>
                  {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                  Schedule exam
                </Button>
              </>
            ) : null}
          </form>
        </section>
      ) : papers && papers.length === 0 ? (
        <p className="rounded-md bg-muted/30 p-4 text-sm text-muted-foreground">
          To schedule an online exam, first finalise an exam paper with multiple-choice questions under{" "}
          <Link href="/teacher/exam-papers" className="underline">
            Exam papers
          </Link>
          .
        </p>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="sittings-heading">
        <h2 id="sittings-heading" className="font-serif text-lg font-medium">
          Scheduled exams
        </h2>
        {sittings === null ? (
          error ? null : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )
        ) : sittings.length === 0 ? (
          <p className="rounded-md bg-muted/30 p-6 text-sm text-muted-foreground">No online exams yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {sittings.map((s) => (
              <li key={s.id}>
                <Link href={`/teacher/cbt/${s.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-muted/40">
                  <div className="flex min-w-0 items-start gap-3">
                    <MonitorCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-medium">{s.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {s.classLevelName} {s.subjectName} · {s.armNames.join(", ")} · {describeSittingTime(s)} ·{" "}
                        {s.candidateCount} student{s.candidateCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <Badge variant={s.status === "PUBLISHED" ? "success" : s.status === "CLOSED" ? "muted" : "outline"}>
                    {cbtStatusLabel(s.status)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
