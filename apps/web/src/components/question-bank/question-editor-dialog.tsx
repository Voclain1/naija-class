"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  QUESTION_DIFFICULTIES,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTIONS_MIN,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type QuestionDto,
  type UpdateQuestionInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OPTION_LETTERS,
  addOption,
  emptyQuestionForm,
  formToInput,
  questionToForm,
  removeOption,
  type QuestionFormResult,
  type QuestionFormValues,
} from "@/lib/question-bank/question-form";
import { cn } from "@/lib/utils";

// Phase 8c / CP5b — write or edit one question.
//
// Editing an APPROVED question does not change it: the API saves a new draft
// that replaces it once approved. The dialog says so before the teacher types,
// because "I edited it and the paper still shows the old wording" would
// otherwise read as a bug.

const FIELD =
  "rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const DIFFICULTY_LABELS = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" } as const;

interface Props {
  open: boolean;
  /** Null to write a new question. */
  question: QuestionDto | null;
  defaultTopic?: string;
  onCancel: () => void;
  onSave: (input: UpdateQuestionInput) => Promise<void>;
}

export function QuestionEditorDialog({ open, question, defaultTopic, onCancel, onSave }: Props) {
  const [form, setForm] = useState<QuestionFormValues>(() => emptyQuestionForm(defaultTopic));
  const [problem, setProblem] = useState<Extract<QuestionFormResult, { ok: false }> | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset each time the dialog opens, for whichever question it opens on.
  useEffect(() => {
    if (!open) return;
    setForm(question ? questionToForm(question) : emptyQuestionForm(defaultTopic));
    setProblem(null);
    setServerError(null);
  }, [open, question, defaultTopic]);

  const set = <K extends keyof QuestionFormValues>(key: K, value: QuestionFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = formToInput(form);
    if (!result.ok) {
      setProblem(result);
      return;
    }
    setProblem(null);
    setServerError(null);
    setSaving(true);
    try {
      await onSave(result.input);
    } catch (err) {
      setServerError(err instanceof Error && err.message ? err.message : "Couldn't save the question. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (field: Extract<QuestionFormResult, { ok: false }>["field"]) =>
    problem?.field === field ? <p className="text-xs text-destructive">{problem.message}</p> : null;

  const isApproved = question?.status === "APPROVED";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{question ? (isApproved ? "Revise question" : "Edit draft") : "Write a question"}</DialogTitle>
          <DialogDescription>
            {isApproved
              ? "This question is approved, so your changes are saved as a new draft. The approved version stays in use until the draft is approved."
              : "Saved as a draft. It can be used in a paper once the subject teacher or an admin approves it."}
          </DialogDescription>
        </DialogHeader>

        <form id="question-editor" onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="q-type">Type</Label>
              <select
                id="q-type"
                value={form.type}
                onChange={(e) => set("type", e.target.value as QuestionFormValues["type"])}
                disabled={saving}
                className={cn(FIELD, "h-10 py-0")}
              >
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {QUESTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="q-difficulty">Difficulty</Label>
              <select
                id="q-difficulty"
                value={form.difficulty}
                onChange={(e) => set("difficulty", e.target.value as QuestionFormValues["difficulty"])}
                disabled={saving}
                className={cn(FIELD, "h-10 py-0")}
              >
                {QUESTION_DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {DIFFICULTY_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="q-marks">Marks</Label>
              <Input
                id="q-marks"
                inputMode="numeric"
                value={form.marks}
                onChange={(e) => set("marks", e.target.value)}
                disabled={saving}
                aria-invalid={problem?.field === "marks"}
              />
              {fieldError("marks")}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="q-topic">Topic</Label>
            <Input id="q-topic" value={form.topic} onChange={(e) => set("topic", e.target.value)} maxLength={200} disabled={saving} />
            {fieldError("topic")}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="q-text">Question</Label>
            <textarea
              id="q-text"
              value={form.text}
              onChange={(e) => set("text", e.target.value)}
              rows={form.type === "THEORY" ? 5 : 3}
              maxLength={4000}
              disabled={saving}
              className={FIELD}
            />
            {fieldError("text")}
          </div>

          {form.type === "MULTIPLE_CHOICE" ? (
            <fieldset className="flex flex-col gap-2" disabled={saving}>
              <legend className="mb-1 text-sm font-medium">Options — choose the correct answer</legend>
              {form.options.map((text, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-2 rounded-md p-1.5",
                    form.correctIndex === i && "bg-emerald-50 dark:bg-emerald-950/40",
                  )}
                >
                  <input
                    type="radio"
                    name="correct"
                    aria-label={`Option ${OPTION_LETTERS[i]} is correct`}
                    checked={form.correctIndex === i}
                    onChange={() => set("correctIndex", i)}
                    className="h-4 w-4 accent-emerald-700"
                  />
                  <span className="w-4 text-sm font-medium">{OPTION_LETTERS[i]}</span>
                  <Input
                    aria-label={`Option ${OPTION_LETTERS[i]}`}
                    value={text}
                    onChange={(e) => set("options", form.options.map((o, j) => (j === i ? e.target.value : o)))}
                    maxLength={500}
                  />
                  {form.correctIndex === i ? (
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Correct</span>
                  ) : null}
                  {form.options.length > QUESTION_OPTIONS_MIN ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove option ${OPTION_LETTERS[i]}`}
                      onClick={() => setForm((f) => removeOption(f, i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {form.options.length < QUESTION_OPTIONS_MAX ? (
                <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setForm(addOption)}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add option
                </Button>
              ) : null}
              {fieldError("options")}
            </fieldset>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="q-guide">
              {form.type === "MULTIPLE_CHOICE" ? (
                <>
                  Why the answer is right <span className="font-normal text-muted-foreground">(optional)</span>
                </>
              ) : (
                "Expected answer / marking guide"
              )}
            </Label>
            <textarea
              id="q-guide"
              value={form.answerGuide}
              onChange={(e) => set("answerGuide", e.target.value)}
              rows={form.type === "THEORY" ? 5 : 2}
              maxLength={4000}
              disabled={saving}
              className={FIELD}
            />
            {fieldError("answerGuide")}
          </div>

          {serverError ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{serverError}</p>
          ) : null}
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form="question-editor" disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {isApproved ? "Save as new draft" : "Save draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
