"use client";

import { AlertTriangle, Eye, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";

// Phase 3 / Slice 12 — reveal BVN modal. Deliberately requires an explicit
// "Reveal" click (not auto-fetched on open) — the warning banner must be
// seen before the plaintext is requested, and every reveal call is audited
// server-side (staff-bvn.reveal). Migrated onto the shared Dialog primitive
// during the Students & Staff restyle (Phase 2), alongside BvnCaptureModal —
// see that file's comment for why this was deferred here rather than done
// during the Finance restyle.
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
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-amber-700" />
            Reveal BVN
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Revealing the full BVN is logged to this school&apos;s audit
            trail, including who revealed it and when.
          </span>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {revealed && (
          <div className="rounded-md border bg-muted/30 p-4 text-center">
            <span className="font-mono text-lg tracking-widest">{revealed}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
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
      </DialogContent>
    </Dialog>
  );
}
