"use client";

import { Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { UserListItemDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";

// Phase 3 / Payroll CP4b — create-payroll-item modal, the counterpart to
// ExpenseFormModal. Deductions are flat named lines (not a PAYE tax-bracket
// engine — see payroll.dto.ts's header comment); the bursar enters each
// deduction amount by hand.
interface DeductionRow {
  name: string;
  amountNaira: string;
}

export function PayrollFormModal({
  open,
  onClose,
  staff,
  defaultPeriod,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  staff: UserListItemDto[];
  defaultPeriod: string;
  onSubmit: (values: {
    userId: string;
    period: string;
    grossSalaryNaira: string;
    deductions: DeductionRow[];
  }) => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const [period, setPeriod] = useState(defaultPeriod);
  const [grossSalaryNaira, setGrossSalaryNaira] = useState("");
  const [deductions, setDeductions] = useState<DeductionRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUserId("");
    setPeriod(defaultPeriod);
    setGrossSalaryNaira("");
    setDeductions([]);
    setError(null);
    setSubmitting(false);
  }, [open, defaultPeriod]);

  if (!open) return null;

  const canSubmit =
    userId &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(period) &&
    grossSalaryNaira &&
    !isNaN(parseFloat(grossSalaryNaira)) &&
    deductions.every((d) => d.name.trim() && d.amountNaira && !isNaN(parseFloat(d.amountNaira)));

  function addDeduction() {
    setDeductions((prev) => [...prev, { name: "", amountNaira: "" }]);
  }

  function updateDeduction(index: number, patch: Partial<DeductionRow>) {
    setDeductions((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function removeDeduction(index: number) {
    setDeductions((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ userId, period, grossSalaryNaira, deductions });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create payroll item.");
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
          <h2 className="text-lg font-semibold">Run payroll</h2>
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
            <Label htmlFor="payroll-staff">Staff member</Label>
            <select
              id="payroll-staff"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Select staff member</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="payroll-period">Period</Label>
            <input
              id="payroll-period"
              type="month"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="payroll-gross">Gross salary (₦ naira)</Label>
            <input
              id="payroll-gross"
              type="number"
              min="0"
              step="0.01"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={grossSalaryNaira}
              onChange={(e) => setGrossSalaryNaira(e.target.value)}
              placeholder="e.g. 300000"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Deductions (optional)</Label>
              <button
                type="button"
                onClick={addDeduction}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
            {deductions.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={d.name}
                  onChange={(e) => updateDeduction(i, { name: e.target.value })}
                  placeholder="e.g. PAYE"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={d.amountNaira}
                  onChange={(e) => updateDeduction(i, { amountNaira: e.target.value })}
                  placeholder="Amount"
                />
                <button
                  type="button"
                  onClick={() => removeDeduction(i)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove deduction"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
