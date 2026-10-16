"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { AiMarkingSettingsDto } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { getAiMarkingSettings, updateAiMarkingSettings } from "@/lib/assignments/assignments-api";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { cn } from "@/lib/utils";

// /settings/ai-marking — Phase 9 / CP4b (docs/modules/phase-9.md §12).
//
// The school's own switch for AI drafts of marking feedback. Off by default.
// Even when on, nothing happens until a teacher presses "Draft with AI" on a
// piece of work, and a draft is never a mark: the teacher reads it, changes
// it, and saves it as their own. Marking by hand is the same either way.
export default function AiMarkingSettingsPage() {
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "school.update");
  const [settings, setSettings] = useState<AiMarkingSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    getAiMarkingSettings()
      .then(setSettings)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load settings."));
  }, [canManage]);

  async function onToggle(next: boolean): Promise<void> {
    setSaving(true);
    try {
      const updated = await updateAiMarkingSettings(next);
      setSettings(updated);
      toast.success(updated.enabled ? "Teachers can now ask for AI drafts." : "AI drafts are off. Teachers mark by hand as before.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">AI marking drafts</h1>
        <p className="text-sm text-muted-foreground">
          When this is on, a teacher marking typed homework can press <strong>Draft with AI</strong> to get a suggested
          mark and feedback. They read it, change it, and save it as their own. Nothing reaches a student or parent
          until the teacher saves it and releases the marks. Teachers who never press the button mark exactly as before.
        </p>
      </header>

      {!canManage ? (
        <div className="rounded-md bg-muted/30 p-4 text-sm text-muted-foreground">You don&apos;t have access to this setting.</div>
      ) : error ? (
        <div className="rounded-md bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      ) : !settings ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : (
        <>
          <div className="rounded-md bg-muted/30 p-4 text-sm">
            <p className="font-medium">What is sent to the AI</p>
            <p className="mt-1 text-muted-foreground">
              The homework&apos;s title, instructions and total, the teacher&apos;s marking guide, and the student&apos;s
              typed answer, with the student&apos;s name, admission number and every classmate&apos;s name removed first.
              Photos, PDFs and records are never sent. Each draft uses the school&apos;s monthly AI allowance.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border bg-card p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Let teachers ask for AI drafts</span>
              <span className="text-xs text-muted-foreground">Off by default. Typed answers only.</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enabled}
              aria-label="Let teachers ask for AI drafts"
              disabled={saving}
              onClick={() => void onToggle(!settings.enabled)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                settings.enabled ? "bg-emerald-600" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
                  settings.enabled ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          {settings.enabled && !settings.aiEnabled && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              AI is switched off for this school by SchoolKit, so teachers won&apos;t see the button while that stays off.
            </p>
          )}
          {settings.enabled && settings.aiEnabled && !settings.aiConfigured && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              AI isn&apos;t set up on this system yet, so teachers won&apos;t see the button. Nothing is wrong with your
              settings.
            </p>
          )}
          {settings.enabled && settings.aiEnabled && !settings.planIncludes && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              AI marking drafts aren&apos;t on your plan, so teachers won&apos;t see the button. See Settings → Plan.
            </p>
          )}
        </>
      )}
    </div>
  );
}
