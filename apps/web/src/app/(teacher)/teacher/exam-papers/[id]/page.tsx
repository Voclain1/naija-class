"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Loader2, Lock, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { QUESTION_TYPE_LABELS, type ExamPaperDto, type GradingComponentDto } from "@school-kit/types";

import { ExportPanel } from "@/components/exam-papers/export-panel";
import { QuestionPickerDialog } from "@/components/exam-papers/question-picker-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { isAuthForcedNavigation } from "@/lib/auth/session-end-navigation";
import {
  deleteExamPaper,
  duplicateExamPaper,
  finaliseExamPaper,
  getExamPaper,
  saveExamPaper,
} from "@/lib/exam-papers/exam-papers-api";
import {
  addQuestions,
  addSection,
  editorFromPaper,
  editorMarks,
  editorToInput,
  isEditorDirty,
  moveQuestion,
  removeQuestion,
  removeSection,
  usedQuestionIds,
  type PaperEditorState,
} from "@/lib/exam-papers/paper-editor";
import { getGradingScheme } from "@/lib/grading/grading-api";
import { OPTION_LETTERS } from "@/lib/question-bank/question-form";

// /teacher/exam-papers/[id] — Phase 8c / CP5c (docs/modules/phase-8.md §22.3).
//
// A DRAFT is edited here locally and saved whole (one PUT). Finalising freezes
// it — in the database too — after which it can only be printed, exported or
// duplicated. A FINAL paper never changes, so what was printed and what is
// stored always agree.

const FIELD =
  "rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export default function ExamPaperPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [paper, setPaper] = useState<ExamPaperDto | null>(null);
  const [saved, setSaved] = useState<PaperEditorState | null>(null);
  const [state, setState] = useState<PaperEditorState | null>(null);
  const [components, setComponents] = useState<GradingComponentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "finalise" | "duplicate" | "delete" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [picking, setPicking] = useState<number | null>(null);

  const applyPaper = useCallback((next: ExamPaperDto) => {
    setPaper(next);
    const editor = editorFromPaper(next);
    setSaved(editor);
    setState(editor);
  }, []);

  useEffect(() => {
    Promise.all([getExamPaper(id), getGradingScheme().catch(() => null)])
      .then(([p, scheme]) => {
        applyPaper(p);
        setComponents(scheme?.components ?? []);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the paper."));
  }, [id, applyPaper]);

  const isDraft = paper?.status === "DRAFT";
  const dirty = Boolean(isDraft && state && saved && isEditorDirty(state, saved));

  // Unsaved edits to a draft are lost on leaving; say so first.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      // Stand down for a forced sign-out: the credential is already gone, so
      // "Stay" cannot save this paper. See lib/auth/session-end-navigation.ts.
      if (isAuthForcedNavigation()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const marks = useMemo(() => (state ? editorMarks(state) : { sections: [], total: 0 }), [state]);

  if (error) {
    return <p className="mx-auto max-w-4xl rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  }
  if (!paper || !state) {
    return (
      <p className="mx-auto flex max-w-4xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const set = <K extends keyof PaperEditorState>(key: K, value: PaperEditorState[K]) => setState((s) => (s ? { ...s, [key]: value } : s));
  const setSection = (i: number, patch: Partial<PaperEditorState["sections"][number]>) =>
    setState((s) => (s ? { ...s, sections: s.sections.map((sec, j) => (j === i ? { ...sec, ...patch } : sec)) } : s));

  async function onSave(): Promise<boolean> {
    if (!state) return false;
    const result = editorToInput(state);
    if (!result.ok) {
      setSaveError(result.message);
      return false;
    }
    setBusy("save");
    setSaveError(null);
    try {
      applyPaper(await saveExamPaper(id, result.input));
      toast.success("Paper saved.");
      return true;
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Couldn't save the paper. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onFinalise() {
    if (dirty && !(await onSave())) return;
    if (!window.confirm("Finalise this paper? It can then be printed and exported, but never changed — only duplicated.")) return;
    setBusy("finalise");
    try {
      applyPaper(await finaliseExamPaper(id));
      toast.success("Paper finalised.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't finalise the paper.");
    } finally {
      setBusy(null);
    }
  }

  async function onDuplicate() {
    setBusy("duplicate");
    try {
      const copy = await duplicateExamPaper(id);
      toast.success("Copy made. You can edit it.");
      router.push(`/teacher/exam-papers/${copy.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't duplicate the paper.");
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!window.confirm("Delete this draft paper? The questions stay in the bank.")) return;
    setBusy("delete");
    try {
      await deleteExamPaper(id);
      router.push("/teacher/exam-papers");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete the paper.");
      setBusy(null);
    }
  }

  const disabled = !isDraft || busy !== null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link href="/teacher/exam-papers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All papers
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight">{paper.title}</h1>
          <p className="text-sm text-muted-foreground">
            {paper.classLevelName} · {paper.subjectName} · {paper.termName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDraft ? (
            <Badge variant="outline">Draft</Badge>
          ) : (
            <Badge variant="success" className="gap-1">
              <Lock className="h-3 w-3" />
              Final{paper.finalisedByName ? ` · ${paper.finalisedByName}` : ""}
            </Badge>
          )}
          <span className="text-sm font-medium tabular-nums" aria-label="Total marks">
            {isDraft ? marks.total : paper.totalMarks} marks
          </span>
        </div>
      </header>

      {!isDraft ? <ExportPanel paper={paper} /> : null}

      {/* ---- Header fields ---- */}
      <section className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm" aria-label="Paper details">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-title">Title</Label>
            <Input id="p-title" value={state.title} onChange={(e) => set("title", e.target.value)} disabled={disabled} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-duration">Minutes</Label>
            <Input id="p-duration" className="w-24" inputMode="numeric" value={state.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value)} disabled={disabled} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-versions">Versions</Label>
            <select id="p-versions" value={state.versionCount} onChange={(e) => set("versionCount", Number(e.target.value))} disabled={disabled} className={`${FIELD} h-10 py-0`}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "A" : `A–${OPTION_LETTERS[n - 1]}`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-column">Gradebook column</Label>
            <select id="p-column" value={state.componentId} onChange={(e) => set("componentId", e.target.value)} disabled={disabled} className={`${FIELD} h-10 py-0`}>
              <option value="">None</option>
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-instructions">General instructions</Label>
          <textarea id="p-instructions" rows={2} value={state.instructions} onChange={(e) => set("instructions", e.target.value)} disabled={disabled} maxLength={2000} className={FIELD} />
        </div>
      </section>

      {/* ---- Sections ---- */}
      {state.sections.map((section, si) => (
        <section key={section.key} className="flex flex-col gap-3 rounded-lg border bg-card p-5 shadow-sm" aria-label={section.title || `Section ${si + 1}`}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <Label htmlFor={`s-title-${si}`}>Section title</Label>
              <Input id={`s-title-${si}`} value={section.title} onChange={(e) => setSection(si, { title: e.target.value })} disabled={disabled} />
            </div>
            <span className="pb-2 text-sm tabular-nums text-muted-foreground">{marks.sections[si]} marks</span>
            {isDraft ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${section.title || "section"}`}
                disabled={disabled || state.sections.length === 1}
                onClick={() => setState((s) => (s ? removeSection(s, si) : s))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`s-instr-${si}`}>Section instructions</Label>
            <Input id={`s-instr-${si}`} value={section.instructions} onChange={(e) => setSection(si, { instructions: e.target.value })} disabled={disabled} />
          </div>

          {section.questions.length === 0 ? (
            <p className="rounded-md bg-muted/30 p-4 text-sm text-muted-foreground">No questions in this section yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {section.questions.map((q, qi) => (
                <li key={q.id} className={`flex items-start gap-3 rounded-md p-3 text-sm ${q.status === "APPROVED" ? "bg-muted/30" : "bg-amber-50 dark:bg-amber-950/40"}`}>
                  <span className="w-6 shrink-0 font-medium tabular-nums">{qi + 1}.</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="whitespace-pre-wrap">{q.text}</span>
                    <span className="text-xs text-muted-foreground">
                      {QUESTION_TYPE_LABELS[q.type]} · {q.marks} mark{q.marks === 1 ? "" : "s"} · {q.topic}
                    </span>
                    {q.status !== "APPROVED" ? (
                      <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Retired since it was added — replace it before finalising.</span>
                    ) : null}
                  </div>
                  {isDraft ? (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" aria-label={`Move question ${qi + 1} up`} disabled={disabled || qi === 0} onClick={() => setState((s) => (s ? moveQuestion(s, si, qi, -1) : s))}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move question ${qi + 1} down`}
                        disabled={disabled || qi === section.questions.length - 1}
                        onClick={() => setState((s) => (s ? moveQuestion(s, si, qi, 1) : s))}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Remove question ${qi + 1}`} disabled={disabled} onClick={() => setState((s) => (s ? removeQuestion(s, si, qi) : s))}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {isDraft ? (
            <Button variant="outline" size="sm" className="self-start" disabled={disabled} onClick={() => setPicking(si)}>
              <Plus className="mr-1 h-4 w-4" />
              Add questions
            </Button>
          ) : null}
        </section>
      ))}

      {isDraft ? (
        <>
          <Button variant="ghost" size="sm" className="self-start" disabled={disabled} onClick={() => setState((s) => (s ? addSection(s) : s))}>
            <Plus className="mr-1 h-4 w-4" />
            Add a section
          </Button>

          {paper.problems.length && !dirty ? (
            <ul className="flex flex-col gap-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" aria-label="Before finalising">
              {paper.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {saveError ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{saveError}</p> : null}

          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 bg-background/95 py-3">
            <Button disabled={!dirty || busy !== null} onClick={() => void onSave()}>
              {busy === "save" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save
            </Button>
            <Button variant="outline" disabled={busy !== null || (!dirty && paper.problems.length > 0)} onClick={() => void onFinalise()}>
              {busy === "finalise" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
              Finalise
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => void onDelete()}>
              Delete draft
            </Button>
            {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
          </div>
        </>
      ) : (
        <Button variant="outline" className="self-start" disabled={busy !== null} onClick={() => void onDuplicate()}>
          {busy === "duplicate" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Copy className="mr-1 h-4 w-4" />}
          Duplicate to edit
        </Button>
      )}

      {picking !== null ? (
        <QuestionPickerDialog
          open
          sectionTitle={state.sections[picking]?.title ?? "this section"}
          subjectId={paper.subjectId}
          classLevelId={paper.classLevelId}
          usedIds={usedQuestionIds(state)}
          defaultType={/objective/i.test(state.sections[picking]?.title ?? "") ? "MULTIPLE_CHOICE" : picking === 0 ? "MULTIPLE_CHOICE" : "THEORY"}
          onClose={() => setPicking(null)}
          onAdd={(qs) => {
            setState((s) => (s ? addQuestions(s, picking, qs) : s));
            setPicking(null);
          }}
        />
      ) : null}
    </div>
  );
}
