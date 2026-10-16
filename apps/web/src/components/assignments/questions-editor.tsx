"use client";

import { useEffect, useState } from "react";
import {
  ASSIGNMENT_LIMITS,
  optionLetter,
  type AssignmentMarkingDto,
  type AssignmentQuestionDto,
  type AssignmentQuestionInput,
  type BankQuestionDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { getBankQuestions, setQuestions } from "@/lib/assignments/assignments-api";

// Phase 9 / CP4.3 — the questions on collected work (docs/modules/phase-9.md
// §11 CP4-D6). Multiple choice and fill-in, marked by the server when a student
// hands in. Edited as a whole list and saved together; fixed once anyone has
// handed in. Multiple choice can be copied in from the question bank.

type Draft = {
  key: string;
  type: AssignmentQuestionInput["type"];
  text: string;
  marks: string;
  options: string[];
  correctIndex: number;
  /** Fill-in: one accepted answer per line. */
  accepted: string;
  sourceQuestionId?: string;
};

let nextKey = 0;
const newKey = () => `q${++nextKey}`;

function fromDto(q: AssignmentQuestionDto): Draft {
  return {
    key: newKey(),
    type: q.type,
    text: q.text,
    marks: String(q.marks),
    options: q.options ?? ["", ""],
    correctIndex: q.correctIndex ?? 0,
    accepted: (q.acceptedAnswers ?? []).join("\n"),
  };
}

function fromBank(q: BankQuestionDto): Draft {
  return {
    key: newKey(),
    type: "MULTIPLE_CHOICE",
    text: q.text,
    marks: String(q.marks),
    options: [...q.options],
    correctIndex: q.correctIndex,
    accepted: "",
    sourceQuestionId: q.id,
  };
}

const blank = (type: Draft["type"]): Draft => ({
  key: newKey(),
  type,
  text: "",
  marks: "1",
  options: ["", ""],
  correctIndex: 0,
  accepted: "",
});

function toInput(d: Draft, n: number): AssignmentQuestionInput | string {
  const marks = Number(d.marks);
  if (d.text.trim() === "") return `Question ${n}: write the question.`;
  if (!Number.isInteger(marks) || marks < 1 || marks > ASSIGNMENT_LIMITS.questionMarks) {
    return `Question ${n}: give it a whole number of marks, 1 to ${ASSIGNMENT_LIMITS.questionMarks}.`;
  }
  if (d.type === "MULTIPLE_CHOICE") {
    const options = d.options.map((o) => o.trim());
    if (options.some((o) => o === "")) return `Question ${n}: fill in every option, or remove it.`;
    return {
      type: "MULTIPLE_CHOICE",
      text: d.text.trim(),
      marks,
      options,
      correctIndex: d.correctIndex,
      ...(d.sourceQuestionId ? { sourceQuestionId: d.sourceQuestionId } : {}),
    };
  }
  const acceptedAnswers = d.accepted
    .split("\n")
    .map((a) => a.trim())
    .filter((a) => a !== "");
  if (acceptedAnswers.length === 0) return `Question ${n}: list at least one accepted answer.`;
  if (acceptedAnswers.length > ASSIGNMENT_LIMITS.acceptedAnswers) {
    return `Question ${n}: list at most ${ASSIGNMENT_LIMITS.acceptedAnswers} accepted answers.`;
  }
  return { type: "FILL_IN", text: d.text.trim(), marks, acceptedAnswers };
}

const inputClass = "rounded-md border border-input bg-background px-3 text-sm";

function QuestionReadOnly({ q }: { q: AssignmentQuestionDto }) {
  return (
    <li className="flex flex-col gap-1 rounded-md bg-muted/30 p-3 text-sm">
      <p className="break-words">
        <span className="font-medium">{q.number}.</span> {q.text}{" "}
        <span className="text-muted-foreground">
          ({q.marks} mark{q.marks === 1 ? "" : "s"}
          {q.fromBank ? ", from the question bank" : ""})
        </span>
      </p>
      {q.type === "MULTIPLE_CHOICE" ? (
        <ul className="flex flex-col gap-0.5 pl-4">
          {(q.options ?? []).map((o, i) => (
            <li key={i} className="break-words">
              {optionLetter(i)}. {o}
              {i === q.correctIndex && <span className="ml-1 font-medium text-primary">(right answer)</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="break-words pl-4 text-muted-foreground">Accepted: {(q.acceptedAnswers ?? []).join(" · ")}</p>
      )}
    </li>
  );
}

function BankPicker({ homeworkId, onAdd, onClose }: { homeworkId: string; onAdd: (q: BankQuestionDto) => void; onClose: () => void }) {
  const [list, setList] = useState<BankQuestionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    getBankQuestions(homeworkId)
      .then((r) => !cancelled && setList(r.data))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Could not load the question bank."));
    return () => {
      cancelled = true;
    };
  }, [homeworkId]);
  return (
    <section aria-label="Question bank" className="flex flex-col gap-2 rounded-md bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Approved multiple-choice questions for this class and subject</h3>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {!list && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {list && list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          The question bank has no approved multiple-choice questions for this class and subject yet.
        </p>
      )}
      {list && list.length > 0 && (
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {list.map((q) => (
            <li key={q.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-card p-2 text-sm">
              <span className="min-w-0 flex-1 break-words">
                <span className="block text-xs text-muted-foreground">{q.topic}</span>
                {q.text}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={added.has(q.id)}
                onClick={() => {
                  onAdd(q);
                  setAdded(new Set(added).add(q.id));
                }}
              >
                {added.has(q.id) ? "Added" : "Add"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function QuestionsEditor({
  homeworkId,
  data,
  onSaved,
}: {
  homeworkId: string;
  data: AssignmentMarkingDto;
  onSaved: (next: AssignmentMarkingDto) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [bank, setBank] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questionMarks = data.questions.reduce((sum, q) => sum + q.marks, 0);
  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  async function save() {
    const inputs: AssignmentQuestionInput[] = [];
    for (const [i, d] of drafts.entries()) {
      const result = toInput(d, i + 1);
      if (typeof result === "string") {
        setError(result);
        return;
      }
      inputs.push(result);
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await setQuestions(homeworkId, { questions: inputs }));
      setEditing(false);
      setBank(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the questions. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <section aria-label="Questions" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Questions</h2>
          {data.questionsEditable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDrafts(data.questions.map(fromDto));
                setEditing(true);
                setError(null);
              }}
            >
              {data.questions.length === 0 ? "Add questions" : "Edit questions"}
            </Button>
          )}
        </div>
        {data.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {data.questionsEditable
              ? "Optional. Multiple-choice and fill-in questions are marked automatically when a student hands in; you check the mark before releasing it."
              : "No questions on this work."}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Worth {questionMarks} of the {data.collection.totalMarks} marks. Marked automatically when a student hands in.
              {data.questionsEditable ? "" : " Fixed now that students have started handing in."}
            </p>
            <ol className="flex flex-col gap-2">
              {data.questions.map((q) => (
                <QuestionReadOnly key={q.id} q={q} />
              ))}
            </ol>
          </>
        )}
      </section>
    );
  }

  const draftMarks = drafts.reduce((sum, d) => sum + (Number(d.marks) || 0), 0);

  return (
    <section aria-label="Edit questions" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="font-medium">Questions</h2>
      <p className="text-sm text-muted-foreground">
        A fill-in answer is right when it matches one you list, ignoring capital letters and extra spaces. Nothing
        else counts as close enough, so list every spelling you accept. Questions can&apos;t change once a student has
        handed in.
      </p>
      <ol className="flex flex-col gap-3">
        {drafts.map((d, i) => (
          <li key={d.key} className="flex flex-col gap-2 rounded-md bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {i + 1}. {d.type === "MULTIPLE_CHOICE" ? "Multiple choice" : "Fill in the blank"}
                {d.sourceQuestionId ? " · from the question bank" : ""}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}
              >
                Remove
              </Button>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span>Question</span>
              <textarea
                rows={2}
                maxLength={ASSIGNMENT_LIMITS.questionText}
                value={d.text}
                onChange={(e) => update(d.key, { text: e.target.value })}
                className={`${inputClass} py-2`}
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-sm">
              <span>Marks</span>
              <input
                inputMode="numeric"
                value={d.marks}
                onChange={(e) => update(d.key, { marks: e.target.value })}
                className={`${inputClass} h-10`}
              />
            </label>
            {d.type === "MULTIPLE_CHOICE" ? (
              <fieldset className="flex min-w-0 flex-col gap-2 text-sm">
                <legend className="mb-1">Options (tick the right one)</legend>
                {d.options.map((o, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`right-${d.key}`}
                      aria-label={`Option ${optionLetter(oi)} is right`}
                      checked={d.correctIndex === oi}
                      onChange={() => update(d.key, { correctIndex: oi })}
                      className="h-5 w-5 shrink-0"
                    />
                    <span className="w-4 shrink-0">{optionLetter(oi)}</span>
                    <input
                      aria-label={`Option ${optionLetter(oi)}`}
                      value={o}
                      maxLength={ASSIGNMENT_LIMITS.optionText}
                      onChange={(e) => update(d.key, { options: d.options.map((x, xi) => (xi === oi ? e.target.value : x)) })}
                      className={`${inputClass} h-10 min-w-0 flex-1`}
                    />
                    {d.options.length > ASSIGNMENT_LIMITS.optionsMin && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Remove option ${optionLetter(oi)}`}
                        onClick={() =>
                          update(d.key, {
                            options: d.options.filter((_, xi) => xi !== oi),
                            correctIndex: d.correctIndex === oi ? 0 : d.correctIndex > oi ? d.correctIndex - 1 : d.correctIndex,
                          })
                        }
                      >
                        ×
                      </Button>
                    )}
                  </div>
                ))}
                {d.options.length < ASSIGNMENT_LIMITS.optionsMax && (
                  <div>
                    <Button type="button" size="sm" variant="outline" onClick={() => update(d.key, { options: [...d.options, ""] })}>
                      Add an option
                    </Button>
                  </div>
                )}
              </fieldset>
            ) : (
              <label className="flex flex-col gap-1 text-sm">
                <span>Accepted answers, one per line</span>
                <textarea
                  rows={3}
                  value={d.accepted}
                  onChange={(e) => update(d.key, { accepted: e.target.value })}
                  className={`${inputClass} py-2`}
                />
              </label>
            )}
          </li>
        ))}
      </ol>
      {drafts.length < ASSIGNMENT_LIMITS.questions && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setDrafts([...drafts, blank("MULTIPLE_CHOICE")])}>
            Add multiple choice
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setDrafts([...drafts, blank("FILL_IN")])}>
            Add fill in the blank
          </Button>
          {!bank && (
            <Button type="button" size="sm" variant="outline" onClick={() => setBank(true)}>
              Copy from the question bank
            </Button>
          )}
        </div>
      )}
      {bank && (
        <BankPicker homeworkId={homeworkId} onAdd={(q) => setDrafts((list) => [...list, fromBank(q)])} onClose={() => setBank(false)} />
      )}
      <p className={`text-sm ${draftMarks > data.collection.totalMarks ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
        The questions add up to {draftMarks} of the {data.collection.totalMarks} marks.
        {draftMarks > data.collection.totalMarks ? " That is more than the total: raise the total first." : ""}
      </p>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
          Save questions
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
