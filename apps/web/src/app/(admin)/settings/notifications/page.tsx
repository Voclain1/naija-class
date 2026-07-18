"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/notifications/notifications-api";
import { cn } from "@/lib/utils";

// Duplicated per-file rather than a shared hook — same pattern already used
// in finance/payroll/page.tsx, staff/bvn-section.tsx, and
// components/students/guardians-tab.tsx. See docs/deferred.md ("Shared
// usePermissions hook") for the case to extract it.
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

// /settings/notifications — Phase 4 / Slice 6 (D3). Per-school email/SMS
// toggles. Owner/admin only — hidden (not disabled) for bursar, same
// precedent as the guardian-invite action in guardians-tab.tsx. Push is
// deliberately absent here: dark until the mobile phase, not a knob this
// screen exposes (see NotificationPreferenceDto's own comment).
export default function NotificationSettingsPage() {
  const { permissions } = useAuth();
  const canRead = hasPermission(permissions, "notification-preferences.read");
  const canUpdate = hasPermission(permissions, "notification-preferences.update");

  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null); // persisted
  const [smsEnabled, setSmsEnabled] = useState<boolean | null>(null); // persisted
  const [draftEmail, setDraftEmail] = useState(false);
  const [draftSms, setDraftSms] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prefs = await getNotificationPreferences();
      setEmailEnabled(prefs.emailEnabled);
      setSmsEnabled(prefs.smsEnabled);
      setDraftEmail(prefs.emailEnabled);
      setDraftSms(prefs.smsEnabled);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canRead) void load();
    else setLoading(false);
  }, [canRead, load]);

  const dirty =
    (emailEnabled !== null && draftEmail !== emailEnabled) ||
    (smsEnabled !== null && draftSms !== smsEnabled);

  async function onSave(): Promise<void> {
    setSaving(true);
    try {
      const updated = await updateNotificationPreferences({
        emailEnabled: draftEmail,
        smsEnabled: draftSms,
      });
      setEmailEnabled(updated.emailEnabled);
      setSmsEnabled(updated.smsEnabled);
      setDraftEmail(updated.emailEnabled);
      setDraftSms(updated.smsEnabled);
      toast.success("Notification preferences saved.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!canRead) {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        </header>
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          You don&apos;t have access to this setting.
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Choose which channels School Kit uses to reach guardians — portal
          invitations and fee reminders both respect these settings.
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
          <div className="flex flex-col gap-3">
            <ToggleRow
              label="Email"
              description="Send via Resend."
              checked={draftEmail}
              disabled={!canUpdate || saving}
              onChange={setDraftEmail}
            />
            <ToggleRow
              label="SMS"
              description="Send via Termii. Costs money per message — off by default."
              checked={draftSms}
              disabled={!canUpdate || saving}
              onChange={setDraftSms}
            />
          </div>

          {canUpdate && (
            <div className="flex items-center gap-3">
              <Button type="button" disabled={!dirty || saving} onClick={onSave}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </Button>
              {dirty && <span className="text-xs text-amber-700">Unsaved change.</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {/* No shared Switch primitive yet — a minimal accessible toggle,
          same as settings/attendance/page.tsx. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`Toggle ${label.toLowerCase()}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-emerald-600" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
