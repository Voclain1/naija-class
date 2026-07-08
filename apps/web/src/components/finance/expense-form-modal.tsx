"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { ExpenseCategoryDto, ExpenseDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";

// Phase 3 / Slice 13 — create/edit expense modal. Amount entered in naira,
// converted to kobo on submit (same pattern as the fee-catalog item form).
// Category select is populated from the already-fetched category list —
// categoryId is a plain FK (no server-side include), so name resolution
// happens client-side throughout this page.
export function ExpenseFormModal({
  open,
  onClose,
  categories,
  editing,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  categories: ExpenseCategoryDto[];
  editing: ExpenseDto | null;
  onSubmit: (values: {
    categoryId: string;
    amountNaira: string;
    description: string;
    incurredAt: string;
  }) => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [amountNaira, setAmountNaira] = useState("");
  const [description, setDescription] = useState("");
  const [incurredAt, setIncurredAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCategoryId(editing.categoryId);
      setAmountNaira((editing.amount / 100).toFixed(2));
      setDescription(editing.description ?? "");
      setIncurredAt(new Date(editing.incurredAt).toISOString().slice(0, 10));
    } else {
      setCategoryId(categories.find((c) => c.active)?.id ?? "");
      setAmountNaira("");
      setDescription("");
      setIncurredAt(new Date().toISOString().slice(0, 10));
    }
    setError(null);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  if (!open) return null;

  const canSubmit = categoryId && amountNaira && !isNaN(parseFloat(amountNaira)) && incurredAt;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ categoryId, amountNaira, description, incurredAt });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save expense.");
    } finally {
      setSubmitting(false);
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
        className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{editing ? "Edit expense" : "New expense"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="exp-category">Category</Label>
            <select
              id="exp-category"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Select a category</option>
              {categories
                .filter((c) => c.active || c.id === categoryId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {!c.active ? " (inactive)" : ""}
                  </option>
                ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="exp-amount">Amount (₦ naira)</Label>
            <input
              id="exp-amount"
              type="number"
              min="0"
              step="0.01"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={amountNaira}
              onChange={(e) => setAmountNaira(e.target.value)}
              placeholder="e.g. 15000"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="exp-date">Date incurred</Label>
            <input
              id="exp-date"
              type="date"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={incurredAt}
              onChange={(e) => setIncurredAt(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="exp-desc">Description (optional)</Label>
            <textarea
              id="exp-desc"
              rows={2}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="e.g. Generator diesel, June"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
