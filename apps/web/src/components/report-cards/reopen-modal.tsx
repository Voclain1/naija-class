"use client";

import { Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

// Reopen-arm confirmation modal (Phase 2 / Slice 6 cp3). Reopen rolls every card
// in the arm back to DRAFT and is audited — the spec requires a non-empty reason,
// so the submit button stays disabled until the textarea has real text.
//
// Lightweight inline overlay (the app has no shared Dialog primitive yet). The
// parent owns success/failure: onSubmit rejects → we surface nothing and stay
// open (the parent toasts), resolves → the parent closes us.
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

  if (!open) return null;

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RotateCcw className="h-5 w-5 text-amber-700" />
            Reopen arm to DRAFT
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          All cards will return to <span className="font-medium text-foreground">DRAFT</span>. Workflow timestamps are
          cleared. Existing PDFs remain on storage until re-release. This action is audited.
        </p>

        <label className="mt-4 flex flex-col gap-1.5 text-sm">
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

        <div className="mt-5 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Reopen arm
          </button>
        </div>
      </div>
    </div>
  );
}
