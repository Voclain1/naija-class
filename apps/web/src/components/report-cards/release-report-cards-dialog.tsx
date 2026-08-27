"use client";

import { Loader2, Send, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Releasing is the point at which results become visible to families. Keep the
// final action in a dialog so its consequence cannot be mistaken for closing it.
// The parent owns the API request: a rejection leaves this dialog open for a
// deliberate retry and is surfaced by the board's normal error toast.
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
  onConfirm: () => void | Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setSubmitting(false);
  }, [open]);

  const confirm = async () => {
    if (submitting || busy) return;
    setSubmitting(true);
    try {
      await onConfirm();
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
