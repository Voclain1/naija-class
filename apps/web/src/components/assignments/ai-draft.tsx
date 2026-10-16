"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { ASSIGNMENT_LIMITS, type AssignmentMarkingDto, type AssignmentSubmissionDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { collectWork, discardFeedbackDraft, draftAllFeedback, draftFeedback } from "@/lib/assignments/assignments-api";

// Phase 9 / CP4b — AI drafts of marking feedback (docs/modules/phase-9.md §12).
// Shown only when the school has switched drafting on (and the platform and
// the plan allow it). A draft is never a mark: "Use draft" copies it into the
// teacher's own boxes, and only their "Save mark" writes anything. Marking by
// hand is the same whether or not this is here.

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** The marking guide (staff only) and "Draft feedback for all", in the page's settings card. */
export function AiDraftTools({
  homeworkId,
  data,
  onChanged,
}: {
  homeworkId: string;
  data: AssignmentMarkingDto;
  onChanged: (next?: AssignmentMarkingDto) => void;
}) {
  const [guide, setGuide] = useState(data.collection.markingGuide ?? "");
  const [busy, setBusy] = useState<"guide" | "all" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftable = data.roster.filter((r) => r.status === "SUBMITTED" && r.draftStatus === null).length;

  async function saveGuide() {
    setBusy("guide");
    setError(null);
    try {
      onChanged(await collectWork(homeworkId, { totalMarks: data.collection.totalMarks, markingGuide: guide.trim() }));
      setNote("Marking guide saved.");
    } catch (e) {
      setError(message(e, "Could not save the marking guide."));
    } finally {
      setBusy(null);
    }
  }

  async function draftAll() {
    setBusy("all");
    setError(null);
    try {
      const { queued } = await draftAllFeedback(homeworkId);
      setNote(
        queued === 0
          ? "Every typed answer still to mark already has a draft."
          : `Drafting ${queued} answer${queued === 1 ? "" : "s"}. Drafts appear under each student as they're ready.`,
      );
      onChanged();
    } catch (e) {
      setError(message(e, "Could not start the drafts."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/30 p-3" role="region" aria-label="AI drafts">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="h-4 w-4" aria-hidden="true" /> AI drafts (optional)
      </p>
      <p className="text-xs text-muted-foreground">
        Ask for a suggested mark and feedback on typed answers, then check and change it before you save. Names are
        removed before anything is sent. Photos and PDFs are marked by hand.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Marking guide (staff only)</span>
        <textarea
          rows={3}
          maxLength={ASSIGNMENT_LIMITS.markingGuide}
          value={guide}
          placeholder="What a good answer includes, and how the marks are shared out."
          onChange={(e) => setGuide(e.target.value)}
          className="rounded-md border border-input bg-background p-3 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || guide.trim() === (data.collection.markingGuide ?? "")}
          onClick={() => void saveGuide()}
        >
          Save guide
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null || draftable === 0} onClick={() => void draftAll()}>
          {busy === "all" && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
          Draft feedback for all
        </Button>
      </div>
      {note && <p className="text-sm">{note}</p>}
      {error && <InlineAlert>{error}</InlineAlert>}
    </div>
  );
}

/** One attempt's draft: ask for it, wait for it, use it or drop it. */
export function AiDraftPanel({
  attempt,
  onUse,
  onChanged,
}: {
  attempt: AssignmentSubmissionDto;
  onUse: (mark: number, feedback: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = attempt.draft;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(message(e, "That did not work. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (!attempt.body) return null;
  return (
    <div className="flex flex-col gap-2" role="region" aria-label={`AI draft, attempt ${attempt.attempt}`}>
      {!draft && (
        <Button size="sm" variant="outline" className="self-start" disabled={busy} onClick={() => void run(() => draftFeedback(attempt.id))}>
          <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" /> Draft with AI
        </Button>
      )}
      {draft?.status === "PENDING" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Drafting… You can keep marking meanwhile.
        </p>
      )}
      {draft?.status === "FAILED" && (
        <div className="flex flex-col gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          <p>No draft: {draft.failure}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => draftFeedback(attempt.id))}>
              Try again
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => discardFeedbackDraft(attempt.id))}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {draft?.status === "READY" && draft.mark !== null && draft.feedback !== null && (
        <div className="flex flex-col gap-2 rounded-md bg-primary/10 p-3 text-sm">
          <p className="font-medium">AI draft: check it before you use it</p>
          <p>Suggested mark: {draft.mark}</p>
          <p className="whitespace-pre-wrap break-words">{draft.feedback}</p>
          {draft.reason && <p className="text-xs text-muted-foreground">For you, not the student: {draft.reason}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onUse(draft.mark!, draft.feedback!)}>
              Use draft
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => discardFeedbackDraft(attempt.id))}>
              Discard
            </Button>
          </div>
        </div>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
    </div>
  );
}
