"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { PaystackSetupRequestDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createPaystackSetupRequest,
  getPaystackSetupRequest,
} from "@/lib/finance/paystack-setup-api";
import { getSchoolMe, patchSchoolMe } from "@/lib/onboarding/schools-api";
import { cn } from "@/lib/utils";

// /settings/finance/payments — Paystack subaccount routing. Owner/admin only
// (the PATCH /schools/me gate enforces it server-side, same as every other
// settings page here).
//
// ASSISTED SETUP (2026-08-15), replacing the self-serve instructions this
// page shipped with. A school CANNOT create a usable subaccount itself:
// Paystack subaccounts belong to the integration that created them and the
// API holds one platform-wide secret key, so a code from the school's own
// dashboard is invisible to our save-time verification and always fails.
// The school submits banking details here. At fulfilment, the operator's
// ACCT_ code is verified and the API creates/fetch-verifies the school's
// percentage:100 split before atomically enabling payments.
export default function PaymentsSettingsPage() {
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [request, setRequest] = useState<PaystackSetupRequestDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [school, existing] = await Promise.all([
        getSchoolMe(),
        getPaystackSetupRequest(),
      ]);
      setSavedCode(school.paystackSubaccountCode);
      setSavedEnabled(school.paystackPaymentsEnabled);
      setCodeDraft(school.paystackSubaccountCode ?? "");
      setEnabledDraft(school.paystackPaymentsEnabled);
      setRequest(existing);
      // Prefill the business name from the school's own name — the common
      // case — while leaving it editable, since a trading name and a
      // registered banking name are not always the same string.
      setBusinessName((current) => current || school.name);
      setContactEmail((current) => current || (school.email ?? ""));
      setContactPhone((current) => current || (school.phone ?? ""));
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

  async function onSubmitRequest(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    try {
      const created = await createPaystackSetupRequest({
        businessName: businessName.trim(),
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
      });
      setRequest(created);
      toast.success("Request sent. We'll email you the subaccount code shortly.");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Couldn't send the request — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Show the request form only when there's nothing useful to show instead:
  // no code saved, and no request already in flight or fulfilled.
  const showRequestForm =
    !savedCode && (request === null || request.status === "REJECTED");

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
          {request?.status === "REJECTED" && request.notes && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">
                We couldn&apos;t complete your last request
              </p>
              <p className="mt-1 text-muted-foreground">{request.notes}</p>
              <p className="mt-1 text-muted-foreground">
                Correct the details below and send it again.
              </p>
            </div>
          )}

          {showRequestForm ? (
            <form
              onSubmit={onSubmitRequest}
              className="flex flex-col gap-4 rounded-md border bg-card p-4"
            >
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-medium">Request Paystack setup</h2>
                <p className="text-xs text-muted-foreground">
                  We create the Paystack subaccount for you and send back a code to paste below.
                  You can&apos;t create one yourself — a subaccount made in your own Paystack
                  dashboard won&apos;t work with schoolkit. Money settles from Paystack straight
                  to your bank account; it never passes through us, and we take no cut.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="businessName">Business name</Label>
                <Input
                  id="businessName"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                />
                <p className="text-xs text-muted-foreground">
                  What parents see on the Paystack checkout page and on your settlement
                  statements.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="bankName">Bank</Label>
                  <Input
                    id="bankName"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. GTBank"
                    required
                    minLength={2}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="accountNumber">Account number</Label>
                  <Input
                    id="accountNumber"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    pattern="[0-9]{10}"
                    maxLength={10}
                    placeholder="10 digits"
                    required
                    className="font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="accountName">Name on the account</Label>
                <Input
                  id="accountName"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  required
                  minLength={2}
                />
                <p className="text-xs text-muted-foreground">
                  Paystack checks this against the bank. If it doesn&apos;t match exactly, setup
                  fails — copy it from a bank statement rather than from memory.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="contactName">Finance contact</Label>
                  <Input
                    id="contactName"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    required
                    minLength={2}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="contactEmail">Contact email</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor="contactPhone">Contact phone</Label>
                  <Input
                    id="contactPhone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <Button type="submit" disabled={submitting}>
                  {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {submitting ? "Sending…" : "Send request"}
                </Button>
              </div>
            </form>
          ) : request?.status === "PENDING" ? (
            <div className="rounded-md border bg-card p-4 text-sm">
              <p className="font-medium">Setup request received</p>
              <p className="mt-1 text-muted-foreground">
                Sent {new Date(request.submittedAt).toLocaleDateString()} for{" "}
                <strong>{request.businessName}</strong>. We&apos;ll connect it here once the
                Paystack account and routing split are verified. Keep collecting cash, POS, and
                bank transfer payments in the meantime; nothing is blocked.
              </p>
            </div>
          ) : request?.status === "FULFILLED" && request.subaccountCode ? (
            // Found by the browser pass (2026-08-15): without this branch, a
            // school whose request was fulfilled saw NEITHER the form nor any
            // status — just a bare code field with no explanation of where the
            // code was meant to come from. Showing the issued code here also
            // means losing the email is not a dead end.
            <div className="rounded-md border border-emerald-600/40 bg-emerald-600/5 p-4 text-sm">
              <p className="font-medium">Your Paystack subaccount is ready</p>
              <p className="mt-1 text-muted-foreground">
                Created and verified for <strong>{request.businessName}</strong>. Your school is
                connected automatically; no code-pasting step remains.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
            <Label htmlFor="subaccount-code" className="text-sm font-medium">
              Paystack subaccount code
            </Label>
            <p className="text-xs text-muted-foreground">
              Managed by assisted setup. Changing or clearing this code disables Paystack and
              clears its routing split; a new setup request is then required before re-enabling.
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
