"use client";

import { Loader2, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { formatKobo } from "@/lib/finance/format";
import { koboToNairaInput, nairaInputToKobo } from "@/lib/finance/naira-input";
import { listStaffSalaries, setStaffSalary } from "@/lib/finance/payroll-api";

// A staff member's saved monthly salary (2026-10-19), on their staff page.
// Set here or on the invite form; Finance → Payroll fills "Run payroll"
// from it. Shown only to someone who runs payroll (payroll.process): what a
// colleague earns is not every admin's business. Changing it never alters a
// month already on the payroll, and every change is logged.
export function SalarySection({ userId }: { userId: string }) {
  const { permissions } = useAuth();
  const canSee = hasPermission(permissions, "payroll.process");
  const [saved, setSaved] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listStaffSalaries();
      setSaved(all.find((s) => s.userId === userId)?.monthlyGross ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the salary.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (canSee) void load();
  }, [canSee, load]);

  if (!canSee) return null;

  async function save() {
    const kobo = nairaInputToKobo(value);
    if (kobo === null) {
      setError("Enter an amount in naira, like 150000 or 150,000.50.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await setStaffSalary(userId, { monthlyGross: kobo });
      setSaved(result.monthlyGross);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the salary.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Monthly salary</h2>
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : editing ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              Monthly salary in naira
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={inputId}
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 150,000"
                className="sm:max-w-xs"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void save()} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{saved !== null ? formatKobo(saved) : "Not set"}</span>
              <span className="text-xs text-muted-foreground">
                Filled in for you when you run payroll under{" "}
                <Link href="/finance/payroll" className="underline underline-offset-2">
                  Finance → Payroll
                </Link>
                . Changing it does not change a month already on the payroll.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setValue(saved !== null ? koboToNairaInput(saved) : "");
                setError(null);
                setEditing(true);
              }}
            >
              <Wallet className="h-4 w-4" />
              {saved !== null ? "Change salary" : "Set salary"}
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </section>
  );
}
