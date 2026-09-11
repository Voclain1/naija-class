"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { resolveSchoolBankDetails, type SchoolMeDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSchoolMe, patchSchoolMe } from "@/lib/onboarding/schools-api";

// "Bank transfer details" — the account PARENTS are shown.
//
// This sits on the same page as "Request Paystack setup", which also asks for
// a bank name, account name and account number. In practice they are usually
// the SAME account, and that is exactly why the copy below has to be explicit:
//
//   - The Paystack form's details are sent to us once so we can create the
//     subaccount. They are operator-facing and are never displayed to parents.
//   - These details are DISPLAYED — on the finance dashboard and in reminder
//     messages — so a parent can transfer directly.
//
// Storing them separately rather than reusing the Paystack request is
// deliberate: that record is guarded behind an individually-audited reveal,
// may not exist at all for a school that does not use Paystack, and is a
// record of a request rather than current truth.

const BLANK = { bankName: "", bankAccountName: "", bankAccountNumber: "" };

export function BankTransferSettings() {
  const [form, setForm] = useState(BLANK);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSchoolMe()
      .then((school: SchoolMeDto) => {
        setForm({
          bankName: school.bankName ?? "",
          bankAccountName: school.bankAccountName ?? "",
          bankAccountNumber: school.bankAccountNumber ?? "",
        });
        setEnabled(school.bankDetailsEnabled);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load bank details."))
      .finally(() => setLoading(false));
  }, []);

  // The same helper the finance dashboard and the reminder message use, so the
  // preview below cannot promise something those surfaces would not show.
  const preview = resolveSchoolBankDetails({
    bankName: form.bankName || null,
    bankAccountName: form.bankAccountName || null,
    bankAccountNumber: form.bankAccountNumber || null,
    bankDetailsEnabled: enabled,
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await patchSchoolMe({
        bankName: form.bankName.trim() || null,
        bankAccountName: form.bankAccountName.trim() || null,
        bankAccountNumber: form.bankAccountNumber.trim() || null,
        bankDetailsEnabled: enabled,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save bank details.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading bank details…
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-md border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Bank transfer details</h2>
        <p className="text-xs text-muted-foreground">
          The account parents transfer into when they would rather not pay by card. Shown on your
          finance dashboard and included in fee reminders.{" "}
          <strong className="font-medium text-foreground">
            This is separate from the Paystack details above
          </strong>{" "}
          — those are sent to us once to create your subaccount and are never shown to parents,
          while these are displayed. They are usually the same account.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="bank-name">Bank name</Label>
        <Input
          id="bank-name"
          value={form.bankName}
          onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
          placeholder="e.g. Zenith Bank"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="bank-account-name">Account name</Label>
        <Input
          id="bank-account-name"
          value={form.bankAccountName}
          onChange={(e) => setForm((f) => ({ ...f, bankAccountName: e.target.value }))}
          placeholder="The name on the account"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="bank-account-number">Account number</Label>
        <Input
          id="bank-account-number"
          value={form.bankAccountNumber}
          onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))}
          inputMode="numeric"
          maxLength={10}
          placeholder="10 digits"
        />
        <p className="text-xs text-muted-foreground">
          Nigerian account numbers are exactly 10 digits. Check it carefully — a wrong number sends
          a parent&apos;s money to a stranger.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 rounded"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          Include these details in payment reminders
          <span className="block text-xs text-muted-foreground">
            Nothing is included until you turn this on and all three fields are filled in.
          </span>
        </span>
      </label>

      {/* Exactly what goes into a reminder — or an explicit statement that
          nothing does, which is the more important case to make visible.
          Deliberately NOT "what parents see": there is no parent-facing
          surface for these details yet (the guardian portal was scoped out of
          v1), so the only way a parent receives them is a reminder a staff
          member sends. Copy that promised a portal view would be describing
          something that does not exist. */}
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          What goes into a reminder
        </p>
        {preview ? (
          <div className="mt-1.5">
            <p className="font-medium text-foreground">{preview.bankAccountName}</p>
            <p className="tabular-nums text-foreground">{preview.bankAccountNumber}</p>
            <p className="text-muted-foreground">{preview.bankName}</p>
          </div>
        ) : (
          <p className="mt-1.5 text-muted-foreground">
            Nothing yet — {enabled ? "fill in all three fields" : "turn on the switch above"} to
            include transfer details.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-muted-foreground">Saved.</p>}

      <div>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save bank details"}
        </Button>
      </div>
    </form>
  );
}
