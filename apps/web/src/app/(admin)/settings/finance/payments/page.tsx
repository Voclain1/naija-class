"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { getSchoolMe, patchSchoolMe } from "@/lib/onboarding/schools-api";
import { cn } from "@/lib/utils";

// /settings/finance/payments — Paystack subaccount routing (compressed
// plan-first, 2026-07-31). Owner/admin only (the PATCH /schools/me gate
// enforces it server-side, same as every other settings page here).
//
// The school creates its own subaccount in its own Paystack dashboard and
// pastes the resulting code here — SchoolKit never captures or verifies
// bank details directly. Saving the code triggers a server-side lookup
// (GET /subaccount/:code) so a typo or dead code is caught here, not the
// first time a parent tries to pay. Enabling Paystack payments requires a
// saved code first; every school defaults to manual-only (cash, POS, bank
// transfer), which always remains available regardless of this toggle.
export default function PaymentsSettingsPage() {
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const school = await getSchoolMe();
      setSavedCode(school.paystackSubaccountCode);
      setSavedEnabled(school.paystackPaymentsEnabled);
      setCodeDraft(school.paystackSubaccountCode ?? "");
      setEnabledDraft(school.paystackPaymentsEnabled);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trimmedCode = codeDraft.trim();
  const dirty = trimmedCode !== (savedCode ?? "") || enabledDraft !== savedEnabled;
  // Mirrors the server's "can't enable without a code" rule so the button
  // is disabled before a round-trip, not just after a 409.
  const canEnable = trimmedCode.length > 0;

  async function onSave(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const updated = await patchSchoolMe({
        paystackSubaccountCode: trimmedCode.length > 0 ? trimmedCode : null,
        paystackPaymentsEnabled: enabledDraft,
      });
      setSavedCode(updated.paystackSubaccountCode);
      setSavedEnabled(updated.paystackPaymentsEnabled);
      setCodeDraft(updated.paystackSubaccountCode ?? "");
      setEnabledDraft(updated.paystackPaymentsEnabled);
      // paystackSubaccountBusinessName is only ever non-null right here —
      // the one moment we just re-verified the code against Paystack. This
      // is the admin's only real signal that the code is genuinely THEIR
      // school's account, not merely a syntactically valid one.
      toast.success(
        updated.paystackSubaccountBusinessName
          ? `Connected to "${updated.paystackSubaccountBusinessName}" on Paystack. Payment settings saved.`
          : "Payment settings saved.",
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Payments</h1>
        <p className="text-sm text-muted-foreground">
          Connect your school&apos;s Paystack subaccount to accept card and bank payments from
          parents directly into your own bank account. Manual payment methods (cash, POS, bank
          transfer) always remain available to staff regardless of this setting.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
            <label htmlFor="subaccount-code" className="text-sm font-medium">
              Paystack subaccount code
            </label>
            <p className="text-xs text-muted-foreground">
              Create a subaccount in your own Paystack dashboard (Settings → Subaccounts), then
              paste the code here — it looks like <code>ACCT_xxxxxxxxxx</code>. We verify it with
              Paystack when you save.
            </p>
            <Input
              id="subaccount-code"
              value={codeDraft}
              onChange={(e) => setCodeDraft(e.target.value)}
              placeholder="ACCT_xxxxxxxxxx"
              disabled={saving}
              className="font-mono"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border bg-card p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Accept Paystack payments</span>
              <span className="text-xs text-muted-foreground">
                {enabledDraft ? "Enabled" : "Disabled — manual-only"}
                {!canEnable && " (requires a subaccount code above)"}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabledDraft}
              aria-label="Toggle Paystack payments"
              disabled={saving || (!canEnable && !enabledDraft)}
              onClick={() => setEnabledDraft((d) => !d)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                enabledDraft ? "bg-emerald-600" : "bg-muted-foreground/30",
                !canEnable && !enabledDraft && "opacity-50",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
                  enabledDraft ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" disabled={!dirty || saving} onClick={onSave}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save"}
            </Button>
            {dirty && <span className="text-xs text-amber-700">Unsaved change.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
