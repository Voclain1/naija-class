"use client";

import { useEffect, useState } from "react";

import { formatKobo } from "@school-kit/types";

import { LibraryHeader, message } from "@/components/library/library-shared";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { nairaInputToKobo } from "@/lib/finance/naira-input";
import { getLibraryContext, updateLibrarySettings } from "@/lib/library/library-api";

// Phase 9 / CP6.1 — the library's rules (docs/modules/phase-9.md §14 CP6-D2,
// CP6-D8): the loan period, how many books each kind of borrower may hold,
// and how many renewals. Owner and admin only (library.settings). CP6.2 adds
// the fine rules (CP6-D3): off by default, students only, a daily rate after
// some grace days, up to an optional cap.

type NumberKey = "loanDays" | "studentLimit" | "staffLimit" | "renewalLimit";
const FIELDS: { key: NumberKey; label: string; hint: string; max: number; min: number }[] = [
  { key: "loanDays", label: "Loan period (days)", hint: "How long a book goes out for.", min: 1, max: 180 },
  { key: "studentLimit", label: "Books a student may hold", hint: "At once.", min: 0, max: 20 },
  { key: "staffLimit", label: "Books a member of staff may hold", hint: "At once.", min: 0, max: 50 },
  { key: "renewalLimit", label: "Renewals per loan", hint: "Each renewal runs one loan period from the day it is renewed.", min: 0, max: 10 },
];

export default function LibrarySettingsPage() {
  const { permissions } = useAuth();
  const allowed = hasPermission(permissions, "library.settings");
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [fines, setFines] = useState({ enabled: false, perDay: "", grace: "0", cap: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getLibraryContext()
      .then((c) => {
        setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(c.settings[f.key])])));
        setFines({
          enabled: c.settings.finesEnabled,
          perDay: c.settings.finePerDay ? formatKobo(c.settings.finePerDay).replace(/^₦/, "") : "",
          grace: String(c.settings.fineGraceDays),
          cap: c.settings.fineCap != null ? formatKobo(c.settings.fineCap).replace(/^₦/, "") : "",
        });
      })
      .catch((e) => setError(message(e)));
  }, []);

  async function save() {
    if (!values) return;
    const body: Record<string, number> = {};
    for (const f of FIELDS) {
      const n = Number(values[f.key]);
      if (!Number.isInteger(n) || n < f.min || n > f.max) return setError(`${f.label}: enter a whole number from ${f.min} to ${f.max}.`);
      body[f.key] = n;
    }
    const grace = Number(fines.grace);
    if (!Number.isInteger(grace) || grace < 0 || grace > 30) return setError("Days of grace: enter a whole number from 0 to 30.");
    let perDay = 0;
    if (fines.enabled) {
      const k = nairaInputToKobo(fines.perDay);
      if (k === null || k > 1_000_000) return setError("Fine per day: enter an amount in naira, up to 10,000.");
      perDay = k;
    } else if (fines.perDay.trim()) {
      perDay = nairaInputToKobo(fines.perDay) ?? 0;
    }
    let cap: number | null = null;
    if (fines.cap.trim()) {
      cap = nairaInputToKobo(fines.cap);
      if (cap === null) return setError("Most fine per book: enter an amount in naira, or leave it empty.");
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateLibrarySettings({ ...body, finesEnabled: fines.enabled, finePerDay: perDay, fineGraceDays: grace, fineCap: cap });
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <LibraryHeader title="Library rules" intro="How long books go out for, and how many each borrower may hold." />
      {!allowed ? (
        <p className="text-sm text-muted-foreground">Only the owner or an admin can change the library&apos;s rules.</p>
      ) : (
        <form
          className="space-y-4 rounded-md border bg-card p-4"
          aria-label="Library rules"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {error && <InlineAlert>{error}</InlineAlert>}
          {saved && <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">Rules saved. They apply to books lent from now on.</p>}
          {!values ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`rule-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`rule-${f.key}`}
                    className="w-24"
                    inputMode="numeric"
                    value={values[f.key]}
                    onChange={(e) => setValues((v) => ({ ...v!, [f.key]: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                </div>
              ))}
            </div>
          )}
          {values && (
            <fieldset className="space-y-3 rounded-md bg-muted/40 p-3">
              <legend className="sr-only">Fines</legend>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4" checked={fines.enabled} onChange={(e) => setFines((f) => ({ ...f, enabled: e.target.checked }))} />
                Fine students for late books
              </label>
              <p className="text-xs text-muted-foreground">
                Worked out when the book comes back and added to the family&apos;s fees. Days in the holidays between terms
                are not counted. Staff are never fined.
              </p>
              {fines.enabled && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="rule-fine-per-day">Fine per day (₦)</Label>
                    <Input id="rule-fine-per-day" className="w-28" inputMode="decimal" value={fines.perDay} onChange={(e) => setFines((f) => ({ ...f, perDay: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rule-fine-grace">Days of grace</Label>
                    <Input id="rule-fine-grace" className="w-20" inputMode="numeric" value={fines.grace} onChange={(e) => setFines((f) => ({ ...f, grace: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rule-fine-cap">Most fine per book (₦, optional)</Label>
                    <Input id="rule-fine-cap" className="w-28" inputMode="decimal" value={fines.cap} onChange={(e) => setFines((f) => ({ ...f, cap: e.target.value }))} />
                  </div>
                </div>
              )}
            </fieldset>
          )}
          <Button type="submit" disabled={saving || !values}>
            {saving ? "Saving…" : "Save rules"}
          </Button>
        </form>
      )}
    </div>
  );
}
