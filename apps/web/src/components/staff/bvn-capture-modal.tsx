"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, X } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { captureBvnSchema, type CaptureBvnInput } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Phase 3 / Slice 12 — capture/update BVN modal. Lightweight inline overlay
// (the app has no shared Dialog primitive yet — same pattern as ReopenModal).
// captureBvnSchema is a plain object schema (not .strict()) with exactly the
// one field this form has, so it's safe to reuse directly as the resolver.
export function BvnCaptureModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (bvn: string) => Promise<void>;
}) {
  const form = useForm<CaptureBvnInput>({
    resolver: zodResolver(captureBvnSchema),
    defaultValues: { bvn: "" },
    mode: "onSubmit",
  });

  useEffect(() => {
    if (open) form.reset({ bvn: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values.bvn);
    } catch (e) {
      form.setError("root", {
        type: "manual",
        message: e instanceof Error ? e.message : "Could not save BVN.",
      });
    }
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            Bank Verification Number
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

        <form onSubmit={submit} className="mt-4 flex flex-col gap-3" noValidate>
          {form.formState.errors.root && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {form.formState.errors.root.message}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="bvn-input">11-digit BVN</Label>
            <input
              id="bvn-input"
              inputMode="numeric"
              maxLength={11}
              placeholder="12345678901"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm font-mono tracking-widest ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              {...form.register("bvn")}
              aria-invalid={Boolean(form.formState.errors.bvn)}
              autoFocus
            />
            {form.formState.errors.bvn && (
              <p className="text-sm text-destructive">{form.formState.errors.bvn.message}</p>
            )}
          </div>

          <div className="mt-2 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={form.formState.isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {form.formState.isSubmitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
