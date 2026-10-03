"use client";

import { Loader2, PenLine, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  QUESTION_GENERATE_MAX,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type GenerateQuestionsResponse,
  type QuestionDifficulty,
  type QuestionDto,
  type QuestionScopeDto,
  type QuestionType,
  type UpdateQuestionInput,
} from "@school-kit/types";

import { QuestionCard, type QuestionAction } from "@/components/question-bank/question-card";
import { QuestionEditorDialog } from "@/components/question-bank/question-editor-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  approveQuestion,
  createQuestion,
  discardQuestion,
  generateQuestions,
  getQuestionScope,
  listQuestions,
  retireQuestion,
  updateQuestion,
} from "@/lib/question-bank/question-bank-api";
import { cn } from "@/lib/utils";

// /teacher/question-bank — Phase 8c / CP5b (docs/modules/phase-8.md §22.2).
//
// A school's own exam questions for one class level and subject at a time:
// draft some with AI, write some by hand, and approve each before it can be
// used in a paper (CP5c). Teachers see only the subjects they teach (D62);
// owner/admin see every subject offered, and reach this page from the admin
// sidebar the way they reach lesson plans.

const SELECT =
  "h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const PROGRESS_LINES = [
  "Reading the topic and class level…",
  "Checking your scheme of work…",
  "Writing the questions…",
  "Writing the answers and marking guides…",
  "Almost there…",
];

type Tab = "DRAFT" | "APPROVED" | "RETIRED";
const TAB_LABELS: Record<Tab, string> = { DRAFT: "Drafts to review", APPROVED: "Approved", RETIRED: "Retired" };

function groundingLine(result: GenerateQuestionsResponse): string {
  if (result.grounding.usedScheme) return "Based on your school's scheme of work.";
  switch (result.grounding.reason) {
    case "no-documents":
      return "No scheme of work has been uploaded for this subject and class, so these follow the national curriculum.";
    case "awaiting-review":
      return "Your scheme of work for this subject is still waiting to be confirmed, so these follow the national curriculum.";
    case "ok":
    case "no-match":
      return "This topic wasn't found in your scheme of work, so these follow the national curriculum.";
    default:
      return "Your scheme of work couldn't be searched just now, so these follow the national curriculum.";
  }
}

export default function QuestionBankPage() {
  const [scope, setScope] = useState<QuestionScopeDto | null>(null);
  const [levelId, setLevelId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("DRAFT");
  const [search, setSearch] = useState("");
  const [questions, setQuestions] = useState<QuestionDto[]>([]);
  const [retired, setRetired] = useState<QuestionDto[] | null>(null);
  const [loading, setLoading] = useState(false);

  const [busy, setBusy] = useState<{ id: string; action: QuestionAction } | null>(null);
  const [editing, setEditing] = useState<{ question: QuestionDto | null } | null>(null);

  // AI drafting
  const [topic, setTopic] = useState("");
  const [type, setType] = useState<QuestionType>("MULTIPLE_CHOICE");
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>("MEDIUM");
  const [count, setCount] = useState("5");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<GenerateQuestionsResponse | null>(null);

  // Subjects offered for the chosen level: any subject for owner/admin, only
  // the ones they teach at that level for a teacher (D62).
  const subjectChoices = useMemo(() => {
    if (!scope) return [];
    if (scope.all) return scope.subjects;
    const taught = new Set(scope.pairs.filter((p) => p.classLevelId === levelId).map((p) => p.subjectId));
    return scope.subjects.filter((s) => taught.has(s.id));
  }, [scope, levelId]);

  const pair = useMemo(() => {
    if (!scope || !levelId || !subjectId) return null;
    const level = scope.levels.find((l) => l.id === levelId);
    const subject = subjectChoices.find((s) => s.id === subjectId);
    return level && subject
      ? { classLevelId: level.id, classLevelName: level.name, subjectId: subject.id, subjectName: subject.name }
      : null;
  }, [scope, levelId, subjectId, subjectChoices]);

  useEffect(() => {
    getQuestionScope()
      .then((s) => {
        setScope(s);
        if (!s.all && s.pairs.length === 1) {
          setLevelId(s.pairs[0]!.classLevelId);
          setSubjectId(s.pairs[0]!.subjectId);
        }
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Could not load your subjects."));
  }, []);

  const load = useCallback(async () => {
    if (!pair) return;
    setLoading(true);
    try {
      const filter = { classLevelId: pair.classLevelId, subjectId: pair.subjectId, q: search.trim() || undefined };
      const [current, old] = await Promise.all([
        listQuestions(filter),
        tab === "RETIRED" ? listQuestions({ ...filter, status: "RETIRED" }) : Promise.resolve(null),
      ]);
      setQuestions(current);
      setRetired(old);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load the questions.");
    } finally {
      setLoading(false);
    }
  }, [pair, search, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!generating) return setProgress(0);
    const t = setInterval(() => setProgress((i) => Math.min(i + 1, PROGRESS_LINES.length - 1)), 4000);
    return () => clearInterval(t);
  }, [generating]);

  const drafts = questions.filter((q) => q.status === "DRAFT");
  const approved = questions.filter((q) => q.status === "APPROVED");
  const shown = tab === "DRAFT" ? drafts : tab === "APPROVED" ? approved : (retired ?? []);
  const counts: Record<Tab, number | null> = { DRAFT: drafts.length, APPROVED: approved.length, RETIRED: retired?.length ?? null };

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!pair || !topic.trim()) return;
    setGenerating(true);
    setGenerateError(null);
    setLastResult(null);
    try {
      const result = await generateQuestions({
        classLevelId: pair.classLevelId,
        subjectId: pair.subjectId,
        topic: topic.trim(),
        type,
        difficulty,
        count: Number(count),
      });
      setLastResult(result);
      setTab("DRAFT");
      await load();
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : "Could not draft questions. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function onAction(q: QuestionDto, action: QuestionAction) {
    if (action === "edit") return setEditing({ question: q });
    if (action === "discard" && !window.confirm("Discard this draft? It will be deleted.")) return;
    if (action === "retire" && !window.confirm("Retire this question? It stays on record but can no longer be used in a new paper.")) return;
    setBusy({ id: q.id, action });
    try {
      if (action === "approve") {
        await approveQuestion(q.id);
        toast.success(q.supersedesId ? "Revision approved. The old version is retired." : "Question approved.");
      } else if (action === "discard") {
        await discardQuestion(q.id);
        toast.success("Draft discarded.");
      } else {
        await retireQuestion(q.id);
        toast.success("Question retired.");
      }
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onSave(input: UpdateQuestionInput) {
    if (!pair) return;
    const current = editing?.question ?? null;
    if (!current) {
      await createQuestion({ ...input, classLevelId: pair.classLevelId, subjectId: pair.subjectId });
      toast.success("Draft saved.");
    } else {
      await updateQuestion(current.id, input);
      toast.success(current.status === "APPROVED" ? "Saved as a new draft for approval." : "Draft saved.");
    }
    setEditing(null);
    setTab("DRAFT");
    await load();
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Question bank</h1>
        <p className="text-sm text-muted-foreground">
          Your school&apos;s own exam questions. Draft them with AI or write them yourself — each one is approved by the
          subject teacher or an admin before it can go in a paper.
        </p>
      </header>

      {loadError && !scope ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{loadError}</p>
      ) : !scope ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : scope.levels.length === 0 || scope.subjects.length === 0 ? (
        <p className="rounded-md bg-muted/40 p-6 text-sm text-muted-foreground">
          {scope.all
            ? "There are no active class levels or subjects yet. Set them up under Academics first."
            : "You aren't assigned to teach any subject yet, so there is no question bank to show. Ask an admin to assign you."}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:max-w-xl sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qb-level">Class</Label>
              <select
                id="qb-level"
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
              <Label htmlFor="qb-subject">Subject</Label>
              <select
                id="qb-subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                disabled={!levelId}
                className={SELECT}
              >
                <option value="">Choose a subject…</option>
                {subjectChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {pair ? (
            <>
              {/* ---- AI drafting ---- */}
              <section className="rounded-lg border bg-card p-5 shadow-sm" aria-labelledby="qb-draft-heading">
                <h2 id="qb-draft-heading" className="mb-3 flex items-center gap-2 font-medium">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Draft questions with AI
                </h2>
                <form onSubmit={onGenerate} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qb-topic">Topic</Label>
                    <Input
                      id="qb-topic"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="e.g. Equations of motion"
                      maxLength={200}
                      disabled={generating}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="qb-type">Type</Label>
                      <select id="qb-type" value={type} onChange={(e) => setType(e.target.value as QuestionType)} disabled={generating} className={SELECT}>
                        {QUESTION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {QUESTION_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="qb-difficulty">Difficulty</Label>
                      <select
                        id="qb-difficulty"
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value as QuestionDifficulty)}
                        disabled={generating}
                        className={SELECT}
                      >
                        <option value="EASY">Easy</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HARD">Hard</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="qb-count">How many</Label>
                      <select id="qb-count" value={count} onChange={(e) => setCount(e.target.value)} disabled={generating} className={SELECT}>
                        {Array.from({ length: QUESTION_GENERATE_MAX }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {generateError ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{generateError}</p> : null}
                  {lastResult ? (
                    <p role="status" className="rounded-md bg-primary/5 p-3 text-sm">
                      {lastResult.questions.length} draft{lastResult.questions.length === 1 ? "" : "s"} added for review below.{" "}
                      {lastResult.dropped > 0
                        ? `${lastResult.dropped} more ${lastResult.dropped === 1 ? "was" : "were"} left out because ${lastResult.dropped === 1 ? "it" : "they"} broke the question rules. `
                        : ""}
                      {groundingLine(lastResult)}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" disabled={generating || topic.trim().length < 2}>
                      {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      {generating ? "Drafting…" : "Draft questions"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {generating ? PROGRESS_LINES[progress] : "Takes up to a minute. Nothing is used until you approve it."}
                    </span>
                  </div>
                </form>
              </section>

              {/* ---- The bank ---- */}
              <section className="flex flex-col gap-3" aria-labelledby="qb-bank-heading">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="qb-bank-heading" className="font-serif text-lg font-medium">
                    {pair.classLevelName} {pair.subjectName}
                  </h2>
                  <Button variant="outline" size="sm" onClick={() => setEditing({ question: null })}>
                    <PenLine className="mr-1 h-4 w-4" />
                    Write a question
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div role="tablist" aria-label="Question status" className="inline-flex rounded-md bg-muted p-1">
                    {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
                      <button
                        key={t}
                        role="tab"
                        type="button"
                        aria-selected={tab === t}
                        onClick={() => setTab(t)}
                        className={cn(
                          "rounded px-3 py-1.5 text-sm",
                          tab === t ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
                        )}
                      >
                        {TAB_LABELS[t]}
                        {counts[t] !== null ? ` (${counts[t]})` : ""}
                      </button>
                    ))}
                  </div>
                  <div className="relative min-w-48 flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      aria-label="Search questions"
                      placeholder="Search topic or question"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>

                {loading && questions.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </p>
                ) : shown.length === 0 ? (
                  <p className="rounded-md bg-muted/30 p-6 text-sm text-muted-foreground">
                    {tab === "DRAFT"
                      ? "No drafts waiting. Draft some with AI above, or write one."
                      : tab === "APPROVED"
                        ? "No approved questions yet. Approve drafts to build the bank."
                        : "No retired questions."}
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {shown.map((q) => (
                      <QuestionCard
                        key={q.id}
                        question={q}
                        busy={busy?.id === q.id ? busy.action : null}
                        disabled={busy !== null}
                        onAction={(action) => void onAction(q, action)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </>
      )}

      <QuestionEditorDialog
        open={editing !== null}
        question={editing?.question ?? null}
        defaultTopic={topic}
        onCancel={() => setEditing(null)}
        onSave={onSave}
      />
    </div>
  );
}
