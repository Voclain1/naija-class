"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Reopen-arm confirmation modal (Phase 2 / Slice 6 cp3). Reopen rolls every card
// in the arm back to DRAFT and is audited — the spec requires a non-empty reason,
// so the submit button stays disabled until the textarea has real text.
//
// Migrated onto the shared Dialog primitive (Phase 3 restyle) — same
// "inline overlay predates the primitive" family as BvnCaptureModal/
// BvnRevealModal, migrated on their own section's turn (Phase 2). The
// parent still owns success/failure: onSubmit rejects → we surface
// nothing and stay open (the parent toasts), resolves → the parent
// closes us.
export function ReopenModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset when (re)opened.
  useEffect(() => {
    if (open) {
      setReason("");
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = reason.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(reason.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-amber-700" />
            Reopen arm to DRAFT
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            All cards will return to <span className="font-medium text-foreground">DRAFT</span>. Workflow timestamps are
            cleared. Existing PDFs remain on storage until re-release. This action is audited.
          </p>
        </DialogHeader>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Reason for reopening</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why are you reopening this arm?"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Reopen arm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
