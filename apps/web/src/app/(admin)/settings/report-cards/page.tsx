"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getSchoolMe, patchSchoolMe } from "@/lib/onboarding/schools-api";
import { cn } from "@/lib/utils";

// /settings/report-cards — where class position appears (Phase 8 / CP6a,
// docs/modules/phase-8.md §20.1, D47/D51). Two switches, deliberately: what the
// printed report card carries, and what families see in the portal and the
// app. A school may print rank on the paper it hands out and still keep it off
// the screens. Owner/admin only (the PATCH /schools/me gate enforces it).

interface PositionSettings {
  positionOnReportCardPdf: boolean;
  positionVisibleToFamilies: boolean;
}

const SWITCHES: { key: keyof PositionSettings; label: string; on: string; off: string }[] = [
  {
    key: "positionOnReportCardPdf",
    label: "Show class position on printed report cards",
    on: "The PDF shows each student's position in class and in each subject.",
    off: "The PDF leaves position out entirely.",
  },
  {
    key: "positionVisibleToFamilies",
    label: "Show class position to parents and students",
    on: "Families see position in the parent portal and the app.",
    off: "Families do not see position on screen.",
  },
];

export default function ReportCardSettingsPage() {
  const [saved, setSaved] = useState<PositionSettings | null>(null);
  const [draft, setDraft] = useState<PositionSettings>({ positionOnReportCardPdf: true, positionVisibleToFamilies: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const school = await getSchoolMe();
      const value = {
        positionOnReportCardPdf: school.positionOnReportCardPdf,
        positionVisibleToFamilies: school.positionVisibleToFamilies,
      };
      setSaved(value);
      setDraft(value);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    saved !== null &&
    (draft.positionOnReportCardPdf !== saved.positionOnReportCardPdf ||
      draft.positionVisibleToFamilies !== saved.positionVisibleToFamilies);

  async function onSave(): Promise<void> {
    setSaving(true);
    try {
      const updated = await patchSchoolMe(draft);
      const value = {
        positionOnReportCardPdf: updated.positionOnReportCardPdf,
        positionVisibleToFamilies: updated.positionVisibleToFamilies,
      };
      setSaved(value);
      setDraft(value);
      toast.success("Report card settings saved.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Report cards</h1>
        <p className="text-sm text-muted-foreground">
          Choose where class position appears. Changes apply to report cards printed from now on and to
          what families see the next time they open their results; cards already printed are not changed.
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
            {SWITCHES.map((s) => {
              const value = draft[s.key];
              return (
                <div key={s.key} className="flex items-center justify-between gap-4 rounded-md border bg-card p-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className="text-xs text-muted-foreground">{value ? s.on : s.off}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={value}
                    aria-label={s.label}
                    disabled={saving}
                    onClick={() => setDraft((d) => ({ ...d, [s.key]: !d[s.key] }))}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                      value ? "bg-emerald-600" : "bg-muted-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
                        value ? "translate-x-5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>
              );
            })}
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
