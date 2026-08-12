"use client";

import { ArrowLeft, BookOpenCheck, Check, FileQuestion, Loader2, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { LessonPlanDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  deleteLessonPlan,
  generateLessonQuiz,
  getLessonPlan,
  updateLessonPlan,
} from "@/lib/lesson-plans/lesson-plans-api";

// /teacher/lesson-plans/[id] — Phase 5 / Slice 2.
//
// Each section saves INDEPENDENTLY. That mirrors the schema decision (five
// separate columns rather than one JSON blob) and exists for the same reason:
// a teacher tweaking the homework while the page also holds a stale copy of
// the main content should not have their edit clobber the other field. One
// PATCH per section, carrying only that section.
//
// PRINTING: the sections are <textarea>s, and a browser prints only a
// textarea's VISIBLE box — anything past `rows` is silently clipped off the
// paper. A teacher printing a plan to teach from would have got a truncated
// one. So every section renders twice: the editable textarea (screen only)
// and a plain-text block (print only), same convention and same reason as
// components/teacher/gradebook/gradebook-grid.tsx. The layout already hides
// sidebar/topbar in print; everything interactive on THIS page —
// back link, Save buttons, quiz/accept/delete actions — is print:hidden here.

type SectionKey = "introduction" | "mainContent" | "activities" | "assessment" | "homework";

const SECTIONS: Array<{ key: SectionKey; label: string; hint: string }> = [
  { key: "introduction", label: "Introduction", hint: "Hook, prior knowledge, objectives" },
  { key: "mainContent", label: "Main content", hint: "What you teach, in order" },
  { key: "activities", label: "Activities", hint: "Student work, timings, materials" },
  { key: "assessment", label: "Assessment", hint: "Checking understanding" },
  { key: "homework", label: "Homework", hint: "Task to set" },
];

export default function LessonPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [plan, setPlan] = useState<LessonPlanDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local edit buffers, keyed by section. Only sections the teacher has
  // actually touched are dirty — an untouched section is never PATCHed.
  const [drafts, setDrafts] = useState<Partial<Record<SectionKey, string>>>({});
  const [savingKey, setSavingKey] = useState<SectionKey | null>(null);
  const [savedKey, setSavedKey] = useState<SectionKey | null>(null);
  const [busy, setBusy] = useState<"quiz" | "accept" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlan(await getLessonPlan(id));
      setDrafts({});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this lesson plan.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Nothing here autosaves — a section is only persisted by its own Save
  // button — so leaving with edits in a buffer loses them silently.
  const hasUnsaved = plan
    ? SECTIONS.some(({ key }) => drafts[key] !== undefined && drafts[key] !== (plan[key] ?? ""))
    : false;

  // Two exits, two mechanisms, because neither covers the other:
  //
  //   • beforeunload catches tab close / reload / typing a new URL. It does
  //     NOT fire on a client-side route change.
  //   • A capture-phase document click catches in-app navigation. It has to be
  //     document-level, not an onClick on this page's own back link: the most
  //     likely way out is the SIDEBAR, which is a sibling component this page
  //     has no handle on. Capture phase so it runs before Next's router picks
  //     the click up.
  useEffect(() => {
    if (!hasUnsaved) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();

    const onClick = (e: MouseEvent) => {
      // Leave modified clicks (open-in-new-tab etc.) alone — they don't
      // navigate this document, so nothing is lost.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      // Same-page links aren't an exit.
      const dest = new URL(anchor.href, window.location.origin);
      if (dest.pathname === window.location.pathname) return;

      if (!window.confirm("You have unsaved edits on this lesson plan. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [hasUnsaved]);

  async function saveSection(key: SectionKey) {
    const value = drafts[key];
    if (value === undefined || !plan) return;
    setSavingKey(key);
    setActionError(null);
    try {
      const updated = await updateLessonPlan(plan.id, { [key]: value });
      setPlan(updated);
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not save that section.");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleQuiz() {
    if (!plan) return;
    // Regeneration REPLACES the existing quiz — same irreversible loss as
    // Delete, so it gets the same confirm. Only when there is one to lose;
    // first-time generation is not destructive and shouldn't be gated.
    if (
      plan.quiz &&
      !window.confirm("Replace the current quiz with a newly generated one? The current one is lost.")
    ) {
      return;
    }
    setBusy("quiz");
    setActionError(null);
    try {
      setPlan(await generateLessonQuiz(plan.id));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not generate the quiz.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAccept() {
    if (!plan) return;
    setBusy("accept");
    setActionError(null);
    try {
      setPlan(await updateLessonPlan(plan.id, { status: plan.status === "ACCEPTED" ? "DRAFT" : "ACCEPTED" }));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not update the status.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!plan) return;
    if (!window.confirm(`Delete the lesson plan for "${plan.topic}"? This cannot be undone.`)) return;
    setBusy("delete");
    try {
      await deleteLessonPlan(plan.id);
      router.push("/teacher/lesson-plans");
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not delete this lesson plan.");
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? "Lesson plan not found."}
        </div>
        <Link
          href="/teacher/lesson-plans"
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to lesson plans
        </Link>
      </div>
    );
  }

  const hasContent = Boolean(plan.introduction);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="print:hidden">
        <Link
          href="/teacher/lesson-plans"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Lesson plans
        </Link>
      </div>

      <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
            {plan.topic}
          </h1>
          <p className="text-sm text-muted-foreground">
            {plan.classLevelName} · {plan.subjectName}
            {plan.durationMinutes ? ` · ${plan.durationMinutes} minutes` : ""}
          </p>
          {plan.objectives ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{plan.objectives}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {plan.status === "ACCEPTED" ? (
            <Badge className="gap-1">
              <BookOpenCheck className="h-3 w-3" />
              Ready to teach
            </Badge>
          ) : (
            <Badge variant="outline">Draft</Badge>
          )}
        </div>
      </header>

      {actionError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive print:hidden">
          {actionError}
        </div>
      ) : null}

      {!hasContent ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium text-foreground">This plan has no generated content.</p>
          <p className="mt-1 text-muted-foreground">
            The generation did not finish. Your topic and settings were kept — generate a new plan
            with the same details from the lesson plans page.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {SECTIONS.map(({ key, label, hint }) => {
            const current = drafts[key] ?? plan[key] ?? "";
            const dirty = drafts[key] !== undefined && drafts[key] !== (plan[key] ?? "");
            return (
              <section key={key} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className="font-serif text-lg font-medium text-foreground">{label}</h2>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </div>
                  <div className="flex items-center gap-2 print:hidden">
                    {savedKey === key ? (
                      <span className="flex items-center gap-1 text-xs text-primary">
                        <Check className="h-3 w-3" />
                        Saved
                      </span>
                    ) : null}
                    {dirty ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void saveSection(key)}
                        disabled={savingKey === key}
                      >
                        {savingKey === key ? (
                          <>
                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                            Saving
                          </>
                        ) : (
                          "Save"
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <textarea
                  value={current}
                  onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                  rows={Math.min(20, Math.max(4, current.split("\n").length + 2))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden"
                />
                {/* Print-only twin of the textarea above — prints in full
                    rather than clipping at the visible box. Renders `current`,
                    not `plan[key]`, so what is on screen (including unsaved
                    edits) is what comes out on paper. */}
                <div className="hidden whitespace-pre-wrap text-sm leading-relaxed text-foreground print:block">
                  {current}
                </div>
              </section>
            );
          })}

          {/* ---------------- Quiz ---------------- */}
          {/* An empty quiz block is only a prompt to generate one — nothing to
              print, so the whole section drops out of print when unset. */}
          <section
            className={`flex flex-col gap-2 rounded-lg border bg-card p-5 print:border-0 print:p-0 ${
              plan.quiz ? "" : "print:hidden"
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-serif text-lg font-medium text-foreground">Quiz</h2>
              <Button
                size="sm"
                variant={plan.quiz ? "outline" : "default"}
                onClick={() => void handleQuiz()}
                disabled={busy !== null}
                className="print:hidden"
              >
                {busy === "quiz" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <FileQuestion className="mr-2 h-4 w-4" />
                    {plan.quiz ? "Regenerate quiz" : "Generate quiz"}
                  </>
                )}
              </Button>
            </div>
            {plan.quiz ? (
              <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-4 font-sans text-sm leading-relaxed text-foreground print:bg-transparent print:p-0">
                {plan.quiz}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                Multiple-choice and short-answer questions with a mark scheme, based on this
                lesson&apos;s content.
              </p>
            )}
          </section>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-3 border-t pt-5 print:hidden">
        {hasContent ? (
          <Button onClick={() => void handleAccept()} disabled={busy !== null} variant="default">
            {busy === "accept" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <BookOpenCheck className="mr-2 h-4 w-4" />
            )}
            {plan.status === "ACCEPTED" ? "Move back to draft" : "Mark as ready to teach"}
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Print
        </Button>
        <Button
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={() => void handleDelete()}
          disabled={busy !== null}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </footer>
    </div>
  );
}
