"use client";

import { FileText, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { ExamPaperSummaryDto, GradingComponentDto, QuestionScopeDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { createExamPaper, getCurrentTermForStaff, listExamPapers } from "@/lib/exam-papers/exam-papers-api";
import { getGradingScheme } from "@/lib/grading/grading-api";
import { getQuestionScope } from "@/lib/question-bank/question-bank-api";

// /teacher/exam-papers — Phase 8c / CP5c (docs/modules/phase-8.md §22.3).
//
// The school's exam papers, and a form to start one. A paper is set for the
// current term, like the gradebook (no term picker), and for a class and
// subject the caller may work on — the question bank's scope (D62).

const SELECT =
  "h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export default function ExamPapersPage() {
  const router = useRouter();
  const [papers, setPapers] = useState<ExamPaperSummaryDto[] | null>(null);
  const [scope, setScope] = useState<QuestionScopeDto | null>(null);
  const [term, setTerm] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [components, setComponents] = useState<GradingComponentDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [levelId, setLevelId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("90");
  const [versions, setVersions] = useState("1");
  const [componentId, setComponentId] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listExamPapers(), getQuestionScope(), getCurrentTermForStaff(), getGradingScheme().catch(() => null)])
      .then(([list, s, current, scheme]) => {
        setPapers(list);
        setScope(s);
        setTerm(current);
        const cols = scheme?.components ?? [];
        setComponents(cols);
        // The usual home for an exam's marks, chosen for them.
        const exam = cols.find((c) => c.key === "exam");
        if (exam) setComponentId(exam.id);
        if (!s.all && s.pairs.length === 1) {
          setLevelId(s.pairs[0]!.classLevelId);
          setSubjectId(s.pairs[0]!.subjectId);
        }
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load exam papers."));
  }, []);

  const subjectChoices = useMemo(() => {
    if (!scope) return [];
    if (scope.all) return scope.subjects;
    const taught = new Set(scope.pairs.filter((p) => p.classLevelId === levelId).map((p) => p.subjectId));
    return scope.subjects.filter((s) => taught.has(s.id));
  }, [scope, levelId]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!term || !levelId || !subjectId) return;
    setCreating(true);
    setFormError(null);
    try {
      const paper = await createExamPaper({
        classLevelId: levelId,
        subjectId,
        termId: term.id,
        title: title.trim(),
        durationMinutes: Number(duration),
        versionCount: Number(versions),
        componentId: componentId || null,
      });
      router.push(`/teacher/exam-papers/${paper.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not start the paper. Try again.");
      setCreating(false);
    }
  }

  const durationOk = /^\d+$/.test(duration) && Number(duration) >= 5 && Number(duration) <= 600;
  const canCreate = Boolean(term && levelId && subjectId && title.trim() && durationOk && !creating);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Exam papers</h1>
        <p className="text-sm text-muted-foreground">
          Set a paper from your approved questions, finalise it, then print it or export it as PDF, Word or CSV — with up to four
          versions, each with its own marking scheme.
        </p>
      </header>

      {error ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : !scope || term === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        <>
          <section className="rounded-lg border bg-card p-5 shadow-sm" aria-labelledby="new-paper-heading">
            <h2 id="new-paper-heading" className="mb-3 font-medium">
              Start a paper
            </h2>
            {term === null ? (
              <p className="text-sm text-muted-foreground">There is no current term yet. Ask an admin to set one first.</p>
            ) : scope.levels.length === 0 || scope.subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {scope.all ? "Set up class levels and subjects under Academics first." : "You aren't assigned to teach any subject yet."}
              </p>
            ) : (
              <form onSubmit={onCreate} className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ep-level">Class</Label>
                    <select
                      id="ep-level"
                      value={levelId}
                      onChange={(e) => {
                        setLevelId(e.target.value);
                        setSubjectId("");
                      }}
                      className={SELECT}
                    >
                      <option value="">Choose a class…</option>
                      {scope.levels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ep-subject">Subject</Label>
                    <select id="ep-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!levelId} className={SELECT}>
                      <option value="">Choose a subject…</option>
                      {subjectChoices.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ep-title">Title</Label>
                  <Input id="ep-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`e.g. ${term.name} Examination`} maxLength={200} />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ep-duration">Time allowed (minutes)</Label>
                    <Input id="ep-duration" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ep-versions">Versions</Label>
                    <select id="ep-versions" value={versions} onChange={(e) => setVersions(e.target.value)} className={SELECT}>
                      <option value="1">One (A)</option>
                      <option value="2">Two (A–B)</option>
                      <option value="3">Three (A–C)</option>
                      <option value="4">Four (A–D)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ep-column">Gradebook column</Label>
                    <select id="ep-column" value={componentId} onChange={(e) => setComponentId(e.target.value)} className={SELECT}>
                      <option value="">None</option>
                      {components.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  For {term.name}. Once the paper is final, its total marks become the &ldquo;Out of&rdquo; for that gradebook column.
                </p>
                {formError ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{formError}</p> : null}
                <Button type="submit" className="self-start" disabled={!canCreate}>
                  {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                  Start paper
                </Button>
              </form>
            )}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="papers-heading">
            <h2 id="papers-heading" className="font-serif text-lg font-medium">
              Papers
            </h2>
            {papers && papers.length === 0 ? (
              <p className="rounded-md bg-muted/30 p-6 text-sm text-muted-foreground">No papers yet.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {(papers ?? []).map((p) => (
                  <li key={p.id}>
                    <Link href={`/teacher/exam-papers/${p.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-muted/40">
                      <div className="flex min-w-0 items-start gap-3">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="truncate font-medium">{p.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {p.classLevelName} · {p.subjectName} · {p.termName} · {p.questionCount} question{p.questionCount === 1 ? "" : "s"},{" "}
                            {p.totalMarks} marks
                          </span>
                        </div>
                      </div>
                      {p.status === "FINAL" ? <Badge variant="success">Final</Badge> : <Badge variant="outline">Draft</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
