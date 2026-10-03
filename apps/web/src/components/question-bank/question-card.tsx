"use client";

import { Check, Loader2, Pencil, Sparkles } from "lucide-react";

import { QUESTION_TYPE_LABELS, type QuestionDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OPTION_LETTERS } from "@/lib/question-bank/question-form";
import { cn } from "@/lib/utils";

// Phase 8c / CP5b — one question in the bank, with the actions its status
// allows. AI drafts are labelled in words as well as tinted, so a reviewer can
// never mistake one for a question a colleague wrote and checked.

const DIFFICULTY = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" } as const;

export type QuestionAction = "edit" | "approve" | "discard" | "retire";

interface Props {
  question: QuestionDto;
  busy: QuestionAction | null;
  disabled: boolean;
  onAction: (action: QuestionAction) => void;
}

export function QuestionCard({ question: q, busy, disabled, onAction }: Props) {
  const isAiDraft = q.status === "DRAFT" && q.source === "AI";
  const label = `${q.topic}: ${q.text.slice(0, 60)}`;

  return (
    <article
      aria-label={label}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        isAiDraft ? "bg-violet-50 dark:bg-violet-950/30" : "bg-card",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">{QUESTION_TYPE_LABELS[q.type]}</Badge>
        <Badge variant="muted">{DIFFICULTY[q.difficulty]}</Badge>
        <span className="text-muted-foreground">
          {q.marks} mark{q.marks === 1 ? "" : "s"} · {q.topic}
        </span>
        {isAiDraft ? (
          <span className="inline-flex items-center gap-1 font-medium text-violet-800 dark:text-violet-300">
            <Sparkles className="h-3 w-3" />
            AI draft — check before approving
          </span>
        ) : null}
        {q.status === "APPROVED" ? (
          <Badge variant="success" className="gap-1">
            <Check className="h-3 w-3" />
            Approved{q.approvedByName ? ` by ${q.approvedByName}` : ""}
          </Badge>
        ) : null}
        {q.status === "RETIRED" ? <Badge variant="muted">Retired</Badge> : null}
        {q.supersedesId && q.status === "DRAFT" ? <Badge variant="warning">Revision of an approved question</Badge> : null}
      </div>

      <p className="whitespace-pre-wrap text-sm text-foreground">{q.text}</p>

      {q.type === "MULTIPLE_CHOICE" ? (
        <ol className="flex flex-col gap-1 text-sm">
          {q.options.map((o, i) => (
            <li
              key={o.id}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1",
                o.isCorrect && "bg-emerald-50 dark:bg-emerald-950/40",
              )}
            >
              <span className="w-4 font-medium">{OPTION_LETTERS[i]}</span>
              <span className="flex-1">{o.text}</span>
              {o.isCorrect ? (
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Correct</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {q.answerGuide ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {q.type === "MULTIPLE_CHOICE" ? "Why it is right" : "Marking guide"}
          </summary>
          <p className="mt-1 whitespace-pre-wrap">{q.answerGuide}</p>
        </details>
      ) : null}

      {q.status === "APPROVED" && q.openRevisionId ? (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          A revised draft of this question is waiting for approval. This version stays in use until then.
        </p>
      ) : null}

      {q.status !== "RETIRED" ? (
        <div className="flex flex-wrap items-center gap-2">
          {q.status === "DRAFT" ? (
            <>
              <Button size="sm" disabled={disabled} onClick={() => onAction("approve")}>
                {busy === "approve" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAction("edit")}>
                <Pencil className="mr-1 h-4 w-4" />
                Edit
              </Button>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction("discard")}>
                {busy === "discard" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Discard
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || Boolean(q.openRevisionId)}
                title={q.openRevisionId ? "A revision is already waiting — edit that draft" : undefined}
                onClick={() => onAction("edit")}
              >
                <Pencil className="mr-1 h-4 w-4" />
                Revise
              </Button>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction("retire")}>
                {busy === "retire" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Retire
              </Button>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}
