"use client";

import { Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { SMS_SENDER_ID_PATTERN, type SmsSenderDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { getSmsSender, requestSmsSender } from "@/lib/onboarding/schools-api";

// The school's own SMS sender name (docs/modules/school-identity.md slice 2).
// MTN, Airtel, Glo and 9mobile approve every sender name against the school's
// CAC registration, so the school asks here and SchoolKit does the rest. Until
// a name is approved, the school's SMS go out under SchoolKit's name with the
// school's name at the start of the message.

const STATUS_TEXT: Record<SmsSenderDto["status"], { label: string; tone: string; body: (id: string) => string }> = {
  NONE: { label: "", tone: "", body: () => "" },
  REQUESTED: {
    label: "Waiting for approval",
    tone: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
    body: (id) =>
      `We've received your request for "${id}". Email your CAC certificate and a request letter on your school's letterhead to hello@schoolkit.ng, and we'll submit it to the networks. It usually takes a few working days. Until then, your SMS use SchoolKit's name.`,
  },
  APPROVED: {
    label: "Approved",
    tone: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
    body: (id) => `Your SMS are sent as "${id}".`,
  },
  REJECTED: {
    label: "Not approved",
    tone: "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
    body: (id) =>
      `The networks did not approve "${id}". Your SMS use SchoolKit's name. You can ask for a different name below, or reply to our email to find out why.`,
  },
};

export function SmsSenderCard() {
  const [sender, setSender] = useState<SmsSenderDto | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSmsSender()
      .then((s) => setSender(s))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Could not load your SMS sender name."));
  }, []);

  const trimmed = draft.trim();
  const valid = SMS_SENDER_ID_PATTERN.test(trimmed);
  const replacesApproved = sender?.status === "APPROVED";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      const updated = await requestSmsSender({ senderId: trimmed });
      setSender(updated);
      setDraft("");
      toast.success("Request sent. We'll be in touch about your CAC documents.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send the request. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const status = sender && sender.status !== "NONE" && sender.senderId ? STATUS_TEXT[sender.status] : null;

  return (
    <section className="flex flex-col gap-3 rounded-md border bg-card p-4" aria-labelledby="sms-sender-heading">
      <div className="flex flex-col gap-1">
        <h2 id="sms-sender-heading" className="text-sm font-medium">
          SMS sender name
        </h2>
        <p className="text-xs text-muted-foreground">
          Parents see this as the sender of your SMS instead of &ldquo;SchoolKit&rdquo;. The networks only approve a
          name for a school registered with the CAC, so we&apos;ll ask for your certificate.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : !sender ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          {status && sender.senderId ? (
            <div className={`rounded-md p-3 text-sm ${status.tone}`}>
              <p className="font-medium">
                {sender.senderId} · {status.label}
              </p>
              <p className="mt-1">{status.body(sender.senderId)}</p>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <Label htmlFor="sms-sender-id">
              {sender.status === "NONE" ? "Name to send as" : "Ask for a different name"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="sms-sender-id"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={11}
                placeholder="e.g. VIRGOFIDEL"
                autoComplete="off"
                disabled={saving}
              />
              <Button type="submit" disabled={!valid || saving}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Ask for this name
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              3 to 11 letters and numbers, with at least one letter and no spaces.
              {replacesApproved
                ? " Asking for a new name stops using your approved one until the new one is approved."
                : ""}
            </p>
          </form>
        </>
      )}
    </section>
  );
}
