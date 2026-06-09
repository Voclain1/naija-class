"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getSchoolMe, patchSchoolMe } from "@/lib/onboarding/schools-api";
import { cn } from "@/lib/utils";

// /settings/attendance — the subject-period attendance opt-in (Phase 2 / Slice 8).
// Owner/admin only (the PATCH /schools/me gate enforces it server-side). Off by
// default; turning it on reveals the "Subject attendance" surface to teachers.
export default function AttendanceSettingsPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null); // persisted value
  const [draft, setDraft] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const school = await getSchoolMe();
      setEnabled(school.subjectAttendanceEnabled);
      setDraft(school.subjectAttendanceEnabled);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = enabled !== null && draft !== enabled;

  async function onSave(): Promise<void> {
    setSaving(true);
    try {
      const updated = await patchSchoolMe({ subjectAttendanceEnabled: draft });
      setEnabled(updated.subjectAttendanceEnabled);
      setDraft(updated.subjectAttendanceEnabled);
      toast.success(
        updated.subjectAttendanceEnabled ? "Subject-period attendance enabled." : "Subject-period attendance disabled.",
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
        <h1 className="text-2xl font-semibold tracking-tight">Subject-period attendance</h1>
        <p className="text-sm text-muted-foreground">
          Enable to let subject teachers mark per-period attendance for their assigned subjects, in
          addition to the universal daily register. Disabling hides the feature from teachers; any
          marks already recorded are kept.
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
          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Subject-period attendance</span>
              <span className="text-xs text-muted-foreground">{draft ? "Enabled" : "Disabled"}</span>
            </div>
            {/* No shared Switch primitive yet — a minimal accessible toggle. */}
            <button
              type="button"
              role="switch"
              aria-checked={draft}
              aria-label="Toggle subject-period attendance"
              disabled={saving}
              onClick={() => setDraft((d) => !d)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                draft ? "bg-emerald-600" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
                  draft ? "translate-x-5" : "translate-x-0.5",
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
