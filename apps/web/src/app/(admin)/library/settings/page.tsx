"use client";

import { useEffect, useState } from "react";

import type { LibrarySettingsDto } from "@school-kit/types";

import { LibraryHeader, message } from "@/components/library/library-shared";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { getLibraryContext, updateLibrarySettings } from "@/lib/library/library-api";

// Phase 9 / CP6.1 — the library's rules (docs/modules/phase-9.md §14 CP6-D2,
// CP6-D8): the loan period, how many books each kind of borrower may hold,
// and how many renewals. Owner and admin only (library.settings); fines join
// this page in CP6.2.

const FIELDS: { key: keyof Omit<LibrarySettingsDto, "nextAccession">; label: string; hint: string; max: number; min: number }[] = [
  { key: "loanDays", label: "Loan period (days)", hint: "How long a book goes out for.", min: 1, max: 180 },
  { key: "studentLimit", label: "Books a student may hold", hint: "At once.", min: 0, max: 20 },
  { key: "staffLimit", label: "Books a member of staff may hold", hint: "At once.", min: 0, max: 50 },
  { key: "renewalLimit", label: "Renewals per loan", hint: "Each renewal runs one loan period from the day it is renewed.", min: 0, max: 10 },
];

export default function LibrarySettingsPage() {
  const { permissions } = useAuth();
  const allowed = hasPermission(permissions, "library.settings");
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getLibraryContext()
      .then((c) => setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(c.settings[f.key])]))))
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
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateLibrarySettings(body);
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
          <Button type="submit" disabled={saving || !values}>
            {saving ? "Saving…" : "Save rules"}
          </Button>
        </form>
      )}
    </div>
  );
}
