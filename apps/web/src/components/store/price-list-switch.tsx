"use client";

import { useEffect, useState } from "react";

import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { getStoreSettings, updateStoreSettings } from "@/lib/store/store-api";
import { cn } from "@/lib/utils";

/**
 * Whether parents see the store's price list on the portal and the parent app
 * (2026-10-19). Everyone on the Store page sees the setting; only the owner and
 * admins change it, because it decides what families are shown.
 */
export function PriceListSwitch() {
  const { roles } = useAuth();
  const canChange = roles.some((r) => r.key === "owner" || r.key === "admin");
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStoreSettings()
      .then((s) => setOn(s.pricesForParents))
      .catch(() => setOn(null));
  }, []);

  if (on === null) return null;

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      setOn((await updateStoreSettings(next)).pricesForParents);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Show parents the price list</span>
          <span className="text-xs text-muted-foreground">
            Parents see items with a selling price, by size, as available or out of stock, never how many. They
            cannot order.
            {!canChange && " The owner or an admin can change this."}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Show parents the price list"
          disabled={saving || !canChange}
          onClick={() => void toggle(!on)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            on ? "bg-emerald-600" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
              on ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
