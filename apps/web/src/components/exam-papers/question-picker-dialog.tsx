"use client";

import { Dices, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { QUESTION_TYPES, QUESTION_TYPE_LABELS, type QuestionDto, type QuestionType } from "@school-kit/types";

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
import { ApiError } from "@/lib/api-client";
import { drawQuestions } from "@/lib/exam-papers/exam-papers-api";
import { listQuestions } from "@/lib/question-bank/question-bank-api";
import { cn } from "@/lib/utils";

// Phase 8c / CP5c — add APPROVED questions from the bank to one section of a
// paper: tick them by hand, or draw some at random by type (and topic).
// Questions already on the paper are not offered.

const SELECT =
  "h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface Props {
  open: boolean;
  sectionTitle: string;
  subjectId: string;
  classLevelId: string;
  usedIds: string[];
  /** A sensible default type for the section: objectives → multiple choice. */
  defaultType: QuestionType;
  onClose: () => void;
  onAdd: (questions: QuestionDto[]) => void;
}

export function QuestionPickerDialog({ open, sectionTitle, subjectId, classLevelId, usedIds, defaultType, onClose, onAdd }: Props) {
  const [type, setType] = useState<QuestionType>(defaultType);
  const [search, setSearch] = useState("");
  const [bank, setBank] = useState<QuestionDto[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [drawCount, setDrawCount] = useState("10");
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setPicked(new Set());
    setSearch("");
    setError(null);
  }, [open, defaultType]);

  useEffect(() => {
    if (!open) return;
    setBank(null);
    listQuestions({ subjectId, classLevelId, type, status: "APPROVED", q: search.trim() || undefined })
      .then(setBank)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the question bank."));
  }, [open, subjectId, classLevelId, type, search]);

  const used = useMemo(() => new Set(usedIds), [usedIds]);
  const available = (bank ?? []).filter((q) => !used.has(q.id));

  async function onDraw() {
    setDrawing(true);
    setError(null);
    try {
      const drawn = await drawQuestions({
        subjectId,
        classLevelId,
        type,
        topic: search.trim() || undefined,
        count: Math.max(1, Math.min(50, Number(drawCount) || 1)),
        excludeIds: usedIds,
      });
      if (drawn.length === 0) {
        setError("There are no unused approved questions of that kind to draw from.");
        return;
      }
      onAdd(drawn);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not draw questions.");
    } finally {
      setDrawing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add questions to {sectionTitle}</DialogTitle>
          <DialogDescription>Approved questions from the bank. Questions already on this paper are not shown.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pick-type">Type</Label>
            <select id="pick-type" value={type} onChange={(e) => setType(e.target.value as QuestionType)} className={SELECT}>
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pick-search">Topic or text</Label>
            <Input id="pick-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter, or leave blank for all" />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pick-count">Draw at random</Label>
            <Input id="pick-count" inputMode="numeric" value={drawCount} onChange={(e) => setDrawCount(e.target.value)} className="w-20" />
          </div>
          <Button type="button" variant="outline" disabled={drawing} onClick={() => void onDraw()}>
            {drawing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Dices className="mr-1 h-4 w-4" />}
            Draw {QUESTION_TYPE_LABELS[type].toLowerCase()} questions
          </Button>
          <span className="text-xs text-muted-foreground">From the unused approved questions matching the filter.</span>
        </div>

        {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

        {bank === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : available.length === 0 ? (
          <p className="rounded-md bg-muted/30 p-4 text-sm text-muted-foreground">No unused approved questions of this kind.</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" aria-label="Approved questions">
            {available.map((q) => {
              const checked = picked.has(q.id);
              return (
                <li key={q.id}>
                  <label className={cn("flex cursor-pointer items-start gap-3 rounded-md p-2 text-sm", checked ? "bg-primary/10" : "hover:bg-muted/40")}>
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={checked}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(q.id)) next.delete(q.id);
                          else next.add(q.id);
                          return next;
                        })
                      }
                    />
                    <span className="flex-1">
                      {q.text}
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {q.topic} · {q.marks} mark{q.marks === 1 ? "" : "s"}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={picked.size === 0} onClick={() => onAdd(available.filter((q) => picked.has(q.id)))}>
            Add {picked.size || ""} selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
