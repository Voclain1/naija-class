"use client";

import { ArrowLeft, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { CbtResultRowDto, CbtResultsDto, GradingComponentDto, ScorePreviewRowDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { bulkSaveScores, previewScores } from "@/lib/assessment/assessment-api";
import { chooseCbtAttempt, getCbtResults, saveCbtTheoryMarks } from "@/lib/cbt/cbt-api";
import { cbtFlagLabel, cbtNotReadyReason, parseTheoryMark } from "@/lib/cbt/cbt-format";
import { listComponents } from "@/lib/grading/grading-api";

// /teacher/cbt/[id]/results — online exam results (docs/modules/cbt.md D5,
// D6, D8). The multiple-choice score is marked on the server against the
// frozen paper; the teacher types the theory mark from the paper scripts,
// chooses which computer counts for a student who used two, and sends the
// totals to the gradebook through the same preview-then-save as the
// gradebook's own "Out of" (CP5a). Nothing reaches the gradebook unless the
// teacher saves it here.

const SELECT =
  "h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export default function CbtResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [results, setResults] = useState<CbtResultsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [savingTheory, setSavingTheory] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);

  const [components, setComponents] = useState<GradingComponentDto[]>([]);
  const [componentId, setComponentId] = useState("");
  const [preview, setPreview] = useState<ScorePreviewRowDto[] | null>(null);
  const [sending, setSending] = useState<"preview" | "save" | null>(null);

  const adopt = useCallback((r: CbtResultsDto) => {
    setResults(r);
    setTyped(Object.fromEntries(r.rows.map((row) => [row.studentId, row.theoryMark === null ? "" : String(row.theoryMark)])));
    setPreview(null);
  }, []);

  useEffect(() => {
    getCbtResults(id)
      .then((r) => {
        adopt(r);
        setComponentId((c) => c || r.componentId || "");
      })
      .catch((e) => setError(errorText(e, "Could not load the results.")));
    listComponents()
      .then(setComponents)
      .catch(() => setComponents([]));
  }, [id, adopt]);

  const changed = useMemo(() => {
    if (!results) return [];
    return results.rows.filter((row) => (row.theoryMark === null ? "" : String(row.theoryMark)) !== (typed[row.studentId] ?? "").trim());
  }, [results, typed]);
  const invalid = results
    ? results.rows.filter((row) => parseTheoryMark(typed[row.studentId] ?? "", results.onPaperTotal) === "invalid")
    : [];

  if (error) return <p className="mx-auto max-w-5xl rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (!results) {
    return (
      <p className="mx-auto flex max-w-5xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const ready = results.rows.filter((r) => r.total !== null);
  const names = new Map(results.rows.map((r) => [r.studentId, `${r.lastName}, ${r.firstName}`]));
  const gradebookRows = () =>
    ready.map((r) => ({ studentId: r.studentId, componentId, raw: { mark: r.total!, outOf: results.paperTotal } }));

  async function saveTheory() {
    if (!results) return;
    setSavingTheory(true);
    try {
      const marks = changed.map((row) => ({
        studentId: row.studentId,
        theoryMark: parseTheoryMark(typed[row.studentId] ?? "", results.onPaperTotal) as number | null,
      }));
      adopt(await saveCbtTheoryMarks(id, { marks }));
      toast.success(`Saved ${marks.length} theory mark${marks.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(errorText(e, "Could not save the theory marks."));
    } finally {
      setSavingTheory(false);
    }
  }

  async function choose(attemptId: string) {
    setChoosing(attemptId);
    try {
      adopt(await chooseCbtAttempt(id, attemptId));
    } catch (e) {
      toast.error(errorText(e, "Could not choose that attempt."));
    } finally {
      setChoosing(null);
    }
  }

  async function runPreview() {
    if (!results) return;
    setSending("preview");
    try {
      const res = await previewScores({ termId: results.termId, subjectId: results.subjectId, rows: gradebookRows() });
      setPreview(res.rows);
    } catch (e) {
      toast.error(errorText(e, "Could not preview the gradebook marks."));
    } finally {
      setSending(null);
    }
  }

  async function sendToGradebook() {
    if (!results) return;
    setSending("save");
    try {
      // The same rows the preview showed; the server scales them again.
      await bulkSaveScores({ termId: results.termId, subjectId: results.subjectId, rows: gradebookRows() });
      toast.success(`Saved ${ready.length} mark${ready.length === 1 ? "" : "s"} to the gradebook.`);
      setPreview(null);
    } catch (e) {
      toast.error(errorText(e, "Could not save to the gradebook."));
    } finally {
      setSending(null);
    }
  }

  const component = components.find((c) => c.id === componentId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link href={`/teacher/cbt/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {results.title}
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Results</h1>
        <p className="text-sm text-muted-foreground">
          Multiple choice: {results.questionCount} questions, {results.objectiveTotal} marks, marked automatically.
          {results.onPaperTotal > 0 ? ` Theory on paper: ${results.onPaperTotal} marks, typed in below.` : ""} Paper total:{" "}
          {results.paperTotal}.
        </p>
        {results.status === "PUBLISHED" ? (
          <p className="rounded-md bg-amber-500/10 p-3 text-sm">
            This exam is still open. Answers from computers that have not sent yet will change these results; close the exam
            when every computer has sent.
          </p>
        ) : null}
      </header>

      <section aria-labelledby="results-heading" className="flex flex-col gap-3">
        <h2 id="results-heading" className="sr-only">
          Students
        </h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">Student</th>
                <th className="p-2 font-medium">Online attempt</th>
                <th className="p-2 font-medium">Multiple choice</th>
                {results.onPaperTotal > 0 ? <th className="p-2 font-medium">Theory (/{results.onPaperTotal})</th> : null}
                <th className="p-2 font-medium">Total (/{results.paperTotal})</th>
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              {results.rows.map((row) => (
                <ResultRow
                  key={row.studentId}
                  row={row}
                  results={results}
                  typed={typed[row.studentId] ?? ""}
                  onType={(v) => setTyped((t) => ({ ...t, [row.studentId]: v }))}
                  choosing={choosing}
                  onChoose={(a) => void choose(a)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {results.onPaperTotal > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={changed.length === 0 || invalid.length > 0 || savingTheory} onClick={() => void saveTheory()}>
              {savingTheory ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Save theory marks{changed.length ? ` (${changed.length})` : ""}
            </Button>
            {invalid.length > 0 ? (
              <p className="text-sm text-destructive">Theory marks are whole numbers from 0 to {results.onPaperTotal}.</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="gradebook-heading" className="flex flex-col gap-3 rounded-lg bg-muted/30 p-5">
        <h2 id="gradebook-heading" className="font-medium">
          Send to the gradebook
        </h2>
        <p className="text-sm text-muted-foreground">
          Each total is saved as a mark out of {results.paperTotal} and scaled to the column, exactly as the gradebook&apos;s
          &ldquo;Out of&rdquo; does. You see every mark before anything is saved.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gradebook-column">Gradebook column</Label>
          <select
            id="gradebook-column"
            value={componentId}
            onChange={(e) => {
              setComponentId(e.target.value);
              setPreview(null);
            }}
            className={`${SELECT} max-w-xs`}
          >
            <option value="">Choose a column…</option>
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.weight})
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm">
          {ready.length} of {results.rows.length} students ready.
          {ready.length < results.rows.length ? " The others are listed above with what is missing; they are not sent." : ""}
        </p>
        {changed.length > 0 ? <p className="text-sm text-amber-900">Save the theory marks first.</p> : null}
        <Button
          variant="outline"
          className="self-start"
          disabled={!componentId || ready.length === 0 || changed.length > 0 || sending !== null}
          onClick={() => void runPreview()}
        >
          {sending === "preview" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Preview gradebook marks
        </Button>

        {preview ? (
          <div className="flex flex-col gap-3 rounded-md bg-card p-4" role="region" aria-label="Gradebook preview">
            <p className="font-medium">
              {component ? `${component.label}, out of ${component.weight}` : "Gradebook"} — {preview.length} mark
              {preview.length === 1 ? "" : "s"}
            </p>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {preview.map((p) => (
                <li key={p.studentId}>
                  {names.get(p.studentId)}: {p.raw?.mark}/{p.raw?.outOf} → <strong>{p.score}</strong>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Saving replaces any marks already in this column for these students.</p>
            <div className="flex gap-2">
              <Button disabled={sending !== null} onClick={() => void sendToGradebook()}>
                {sending === "save" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                Save to gradebook
              </Button>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Back
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ResultRow({
  row,
  results,
  typed,
  onType,
  choosing,
  onChoose,
}: {
  row: CbtResultRowDto;
  results: CbtResultsDto;
  typed: string;
  onType: (v: string) => void;
  choosing: string | null;
  onChoose: (attemptId: string) => void;
}) {
  const notReady = cbtNotReadyReason(row);
  const many = row.attempts.length > 1;
  return (
    <tr className={row.needsChoice ? "bg-amber-500/5" : undefined}>
      <td className="p-2">
        <p className="font-medium">
          {row.lastName}, {row.firstName}
        </p>
        <p className="text-xs text-muted-foreground">
          {row.admissionNumber} · {row.armName} · Version {row.version}
        </p>
      </td>
      <td className="p-2">
        {row.attempts.length === 0 ? (
          <span className="text-muted-foreground">No answers received</span>
        ) : (
          <ul className="flex flex-col gap-2">
            {row.attempts.map((a) => {
              const counts = a.id === row.countingAttemptId;
              return (
                <li key={a.id} className={`flex flex-col gap-0.5 rounded p-1.5 ${many && counts ? "bg-primary/10" : ""}`}>
                  <span>
                    {many ? <strong>{a.computerLabel}: </strong> : null}
                    {a.objectiveScore}/{results.objectiveTotal} · {a.answeredCount} of {results.questionCount} answered · {a.minutesTaken} min
                    {a.extraMinutes ? ` (+${a.extraMinutes} min allowed)` : ""}
                  </span>
                  {a.flags.length ? (
                    <span className="text-xs text-amber-900">{a.flags.map((f) => cbtFlagLabel(f, a.focusLosses)).join(" · ")}</span>
                  ) : null}
                  {many ? (
                    counts ? (
                      <span className="text-xs font-medium text-primary">Counts</span>
                    ) : (
                      <button
                        type="button"
                        className="self-start text-xs underline"
                        disabled={choosing !== null}
                        onClick={() => onChoose(a.id)}
                      >
                        {choosing === a.id ? "Choosing…" : "Use this one"}
                      </button>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </td>
      <td className="p-2 tabular-nums">{row.objectiveScore === null ? "—" : `${row.objectiveScore}/${results.objectiveTotal}`}</td>
      {results.onPaperTotal > 0 ? (
        <td className="p-2">
          <Input
            aria-label={`Theory mark for ${row.firstName} ${row.lastName}`}
            inputMode="numeric"
            className={`h-9 w-20 ${parseTheoryMark(typed, results.onPaperTotal) === "invalid" ? "ring-2 ring-destructive" : ""}`}
            value={typed}
            onChange={(e) => onType(e.target.value)}
          />
        </td>
      ) : null}
      <td className="p-2 tabular-nums">
        {row.total !== null ? <strong>{row.total}</strong> : <span className="text-xs text-muted-foreground">{notReady}</span>}
      </td>
    </tr>
  );
}
