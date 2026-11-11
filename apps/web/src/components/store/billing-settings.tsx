"use client";

import { useEffect, useState } from "react";

import type { StoreSettingsDto, StoreStudentBilling } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { getStoreSettings, updateStoreSettings } from "@/lib/store/store-api";
import { cn } from "@/lib/utils";

// How a student's store order is billed (2026-11-11, docs/modules/store-orders.md):
// on the fees invoice, or on a store invoice of its own, and whether the person
// selling may choose the other way on a sale. Staff and walk-in buyers always
// pay at the counter. The owner and admins decide; everyone else sees it.

const CHOICES: Array<{ value: StoreStudentBilling; title: string; body: string }> = [
  {
    value: "FEES_INVOICE",
    title: "Add to the fees invoice",
    body: "Store items join the child's school fees bill for the term.",
  },
  {
    value: "STORE_INVOICE",
    title: "A separate store invoice",
    body: "Each order gets its own invoice. Parents pay it at the counter or online, apart from school fees.",
  },
];

export function BillingSettings() {
  const { roles } = useAuth();
  const canChange = roles.some((r) => r.key === "owner" || r.key === "admin");
  const [s, setS] = useState<StoreSettingsDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStoreSettings()
      .then(setS)
      .catch(() => setS(null));
  }, []);

  if (!s) return null;

  async function save(patch: Partial<Pick<StoreSettingsDto, "billingDefault" | "sellerMayChooseBilling">>) {
    setSaving(true);
    setError(null);
    try {
      setS(await updateStoreSettings(patch));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">How students pay for store items</span>
        <span className="text-xs text-muted-foreground">
          Staff and walk-in buyers always pay at the counter.
          {!canChange && " The owner or an admin can change this."}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How students pay for store items">
        {CHOICES.map((c) => {
          const on = s.billingDefault === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={saving || !canChange}
              onClick={() => !on && void save({ billingDefault: c.value })}
              className={cn(
                "flex flex-col items-start gap-1 rounded-md border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed",
                on ? "border-primary bg-primary/10" : "hover:bg-accent disabled:opacity-60",
              )}
            >
              <span className="font-medium">
                {c.title}
                {on && <span className="ml-2 text-xs font-normal text-primary">Chosen</span>}
              </span>
              <span className="text-xs text-muted-foreground">{c.body}</span>
            </button>
          );
        })}
      </div>
      <label className={cn("flex items-start gap-2 text-sm", !canChange && "opacity-60")}>
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={s.sellerMayChooseBilling}
          disabled={saving || !canChange}
          onChange={(e) => void save({ sellerMayChooseBilling: e.target.checked })}
        />
        <span>
          Let the person selling choose the other way on a sale
          <span className="block text-xs text-muted-foreground">For example, a parent who wants to pay for uniforms now, apart from fees.</span>
        </span>
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
