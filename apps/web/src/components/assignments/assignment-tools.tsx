"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AssignmentMarkingDto,
  GradingComponentDto,
  ScorePreviewRowDto,
  SimilarityAnswerDto,
  SimilarityReportDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { bulkSaveScores, previewScores } from "@/lib/assessment/assessment-api";
import { checkSimilarity } from "@/lib/assignments/assignments-api";
import { getGradingScheme } from "@/lib/grading/grading-api";

// Phase 9 / CP4.4 — two tools on the marking page (docs/modules/phase-9.md
// §11 CP4-D8, CP4-D9).
//
// Send to the gradebook: the marked work goes through the gradebook's own
// preview and save as raw marks out of the work's total, scaled by the server
// (D60). No new gradebook code; its scope, enrolment and sign-off rules apply.
//
// Similar wording: on request, which typed answers share a lot of wording, with
// the shared passages highlighted. For staff only, never stored, never part of
// a mark, and never called plagiarism.

const SELECT = "h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm";

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function GradebookPush({ data }: { data: AssignmentMarkingDto }) {
  const [components, setComponents] = useState<GradingComponentDto[] | null>(null);
  const [componentId, setComponentId] = useState("");
  const [preview, setPreview] = useState<ScorePreviewRowDto[] | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // From the scheme, which teachers may read; the component list itself is
    // an admin route.
    getGradingScheme()
      .then((s) => live && setComponents(s.components))
      .catch(() => live && setComponents([]));
    return () => {
      live = false;
    };
  }, []);

  const marked = data.roster.filter((r) => r.status === "MARKED" && r.mark !== null);
  const names = new Map(data.roster.map((r) => [r.studentId, r.name]));
  const rows = () =>
    marked.map((r) => ({ studentId: r.studentId, componentId, raw: { mark: r.mark!, outOf: data.collection.totalMarks } }));
  const component = components?.find((c) => c.id === componentId);

  async function run(kind: "preview" | "save") {
    if (!data.termId) return;
    setBusy(kind);
    setError(null);
    setSaved(null);
    try {
      if (kind === "preview") {
        setPreview((await previewScores({ termId: data.termId, subjectId: data.subjectId, rows: rows() })).rows);
      } else {
        // The same rows the preview showed; the server scales them again.
        await bulkSaveScores({ termId: data.termId, subjectId: data.subjectId, rows: rows() });
        setSaved(`Saved ${marked.length} mark${marked.length === 1 ? "" : "s"} to the gradebook.`);
        setPreview(null);
      }
    } catch (e) {
      setError(message(e, kind === "preview" ? "Could not preview the gradebook marks." : "Could not save to the gradebook."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Send to the gradebook" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="font-medium">Send to the gradebook</h2>
      <p className="text-sm text-muted-foreground">
        Each mark is saved as a mark out of {data.collection.totalMarks} and scaled to the column you choose, as the
        gradebook&apos;s &ldquo;Out of&rdquo; does. You see every mark before anything is saved.
      </p>
      {!data.termId ? (
        <p className="text-sm">There is no current term, so there is no gradebook to send to yet.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Gradebook column</span>
            <select
              value={componentId}
              onChange={(e) => {
                setComponentId(e.target.value);
                setPreview(null);
              }}
              className={SELECT}
            >
              <option value="">Choose a column…</option>
              {(components ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.weight})
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm">
            {marked.length} marked piece{marked.length === 1 ? "" : "s"} of work.
            {data.counts.submitted > 0 ? ` ${data.counts.submitted} still to mark; they are not sent.` : ""}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={!componentId || marked.length === 0 || busy !== null}
            onClick={() => void run("preview")}
          >
            {busy === "preview" && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            Preview gradebook marks
          </Button>
          {preview && (
            <div role="region" aria-label="Gradebook preview" className="flex flex-col gap-3 rounded-md bg-muted/30 p-3">
              <p className="text-sm font-medium">
                {component ? `${component.label}, out of ${component.weight}` : "Gradebook"}: {preview.length} mark
                {preview.length === 1 ? "" : "s"}
              </p>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {preview.map((p) => (
                  <li key={p.studentId} className="break-words">
                    {names.get(p.studentId)}: {p.raw?.mark}/{p.raw?.outOf} → <strong>{p.score}</strong>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Saving replaces any marks already in this column for these students.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy !== null} onClick={() => void run("save")}>
                  Save to gradebook
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setPreview(null)}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {saved && <p className="text-sm text-primary">{saved}</p>}
      {error && <InlineAlert>{error}</InlineAlert>}
    </section>
  );
}

function SharedAnswer({ answer }: { answer: SimilarityAnswerDto }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm font-medium">{answer.name}</p>
      <p className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-sm">
        {answer.segments.map((s, i) =>
          s.shared ? (
            <mark key={i} className="rounded-sm bg-amber-100 text-amber-950 dark:bg-amber-900/50 dark:text-amber-50">
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </p>
    </div>
  );
}

export function SimilarityCheck({ homeworkId }: { homeworkId: string }) {
  const [report, setReport] = useState<SimilarityReportDto | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setReport(await checkSimilarity(homeworkId));
      setOpen(null);
    } catch (e) {
      setError(message(e, "Could not compare the answers. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Similar wording" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="font-medium">Similar wording</h2>
      <p className="text-sm text-muted-foreground">
        Compares every pair of typed answers of 50 words or more, leaving out wording taken from the homework itself.
        It shows answers that share a lot of wording, so you can take a look. It is not a judgement and never part of a
        mark; students and parents don&apos;t see it, and it isn&apos;t saved. Photos and PDFs aren&apos;t compared.
      </p>
      <Button size="sm" variant="outline" className="self-start" disabled={busy} onClick={() => void run()}>
        {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
        {report ? "Check again" : "Check for similar wording"}
      </Button>
      {error && <InlineAlert>{error}</InlineAlert>}
      {report && (
        <>
          <p className="text-sm">
            Compared {report.compared} typed answer{report.compared === 1 ? "" : "s"}
            {report.skippedShort > 0 ? `; ${report.skippedShort} too short to compare` : ""}.{" "}
            {report.pairs.length === 0
              ? "No two answers share a lot of wording."
              : report.pairs.length === 1
                ? "1 pair shares a lot of wording."
                : `${report.pairs.length} pairs share a lot of wording.`}
          </p>
          <ul className="flex flex-col gap-2">
            {report.pairs.map((p, i) => (
              <li key={`${p.a.studentId}-${p.b.studentId}`} className="flex flex-col gap-2 rounded-md bg-muted/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-sm">
                    <span className="font-medium">{p.a.name}</span> and <span className="font-medium">{p.b.name}</span>{" "}
                    share a lot of wording (about {p.overlapPercent}%): worth a look.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={open === i}
                    onClick={() => setOpen(open === i ? null : i)}
                  >
                    {open === i ? "Hide the answers" : "Show the answers"}
                  </Button>
                </div>
                {open === i && (
                  <>
                    <p className="text-xs text-muted-foreground">The wording both answers share is highlighted.</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <SharedAnswer answer={p.a} />
                      <SharedAnswer answer={p.b} />
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
