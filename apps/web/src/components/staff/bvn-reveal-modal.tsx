"use client";

import { AlertTriangle, Eye, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";

// Phase 3 / Slice 12 — reveal BVN modal. Deliberately requires an explicit
// "Reveal" click (not auto-fetched on open) — the warning banner must be
// seen before the plaintext is requested, and every reveal call is audited
// server-side (staff-bvn.reveal). Same inline-overlay pattern as ReopenModal.
export function BvnRevealModal({
  open,
  onClose,
  onReveal,
}: {
  open: boolean;
  onClose: () => void;
  onReveal: () => Promise<string>;
}) {
  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRevealed(null);
      setError(null);
      setRevealing(false);
    }
  }, [open]);

  if (!open) return null;

  async function reveal() {
    setRevealing(true);
    setError(null);
    try {
      const bvn = await onReveal();
      setRevealed(bvn);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reveal BVN.");
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Eye className="h-5 w-5 text-amber-700" />
            Reveal BVN
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Revealing the full BVN is logged to this school&apos;s audit
            trail, including who revealed it and when.
          </span>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {revealed && (
          <div className="mt-4 rounded-md border bg-muted/30 p-4 text-center">
            <span className="font-mono text-lg tracking-widest">{revealed}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {revealed ? "Close" : "Cancel"}
          </Button>
          {!revealed && (
            <Button type="button" onClick={() => void reveal()} disabled={revealing}>
              {revealing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              {revealing ? "Revealing…" : "Reveal"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
