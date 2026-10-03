"use client";

import { Loader2, Send, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import type { ResultAccessModeDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Releasing is the point at which results become visible to families. Keep the
// final action in a dialog so its consequence cannot be mistaken for closing it.
// The parent owns the API request: a rejection leaves this dialog open for a
// deliberate retry and is surfaced by the board's normal error toast.
//
// Phase 8c / CP6b (D48, D18): the release also fixes HOW families reach the
// cards — free in the portal and app, or behind a result PIN. Free is the
// default, today's behaviour. The choice holds until an owner reopens the arm.
const ACCESS_OPTIONS: { value: ResultAccessModeDto; label: string; hint: string }[] = [
  {
    value: "FREE",
    label: "Free",
    hint: "Families see the results in the parent portal and the app.",
  },
  {
    value: "PIN",
    label: "Result PIN required",
    hint: "Families need a result PIN card from the school, on the result checker, the portal or the app.",
  },
];
export function ReleaseReportCardsDialog({
  open,
  armName,
  termName,
  cardCount,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  armName: string;
  termName: string;
  cardCount: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (accessMode: ResultAccessModeDto) => void | Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [accessMode, setAccessMode] = useState<ResultAccessModeDto>("FREE");

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setAccessMode("FREE");
    }
  }, [open]);

  const confirm = async () => {
    if (submitting || busy) return;
    setSubmitting(true);
    try {
      await onConfirm(accessMode);
    } finally {
      setSubmitting(false);
    }
  };

  const cardLabel = `${cardCount} report card${cardCount === 1 ? "" : "s"}`;
  const isBusy = submitting || busy;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !isBusy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-amber-700" />
            Release report cards
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            This will publish <span className="font-medium text-foreground">{cardLabel}</span> for{" "}
            <span className="font-medium text-foreground">{armName}</span> in{" "}
            <span className="font-medium text-foreground">{termName}</span> to the relevant families and students.
          </p>
          <p className="text-sm text-muted-foreground">
            PDFs will begin generating after release. Families may see these results before any later reopen.
          </p>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2" disabled={isBusy}>
          <legend className="mb-1 text-sm font-medium">How families reach these results</legend>
          {ACCESS_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={
                accessMode === option.value
                  ? "flex cursor-pointer items-start gap-3 rounded-md bg-primary/10 p-3"
                  : "flex cursor-pointer items-start gap-3 rounded-md bg-muted/40 p-3"
              }
            >
              <input
                type="radio"
                name="access-mode"
                value={option.value}
                checked={accessMode === option.value}
                onChange={() => setAccessMode(option.value)}
                className="mt-1"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            This can only be changed by reopening the class.
          </p>
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
            Keep reviewing
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={isBusy}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isBusy ? "Releasing…" : `Release ${cardLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
