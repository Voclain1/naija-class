"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { ParentSummaryRowDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import {
  getParentSummarySettings,
  listParentSummaries,
  runParentSummariesNow,
  updateParentSummarySettings,
} from "@/lib/parent-summaries/parent-summaries-api";
import { cn } from "@/lib/utils";

// Duplicated per-file rather than a shared hook — same pattern as
// settings/notifications/page.tsx and the others. See docs/deferred.md
// ("Shared usePermissions hook").
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

// /settings/parent-summaries — Phase 5 / Slice 5.
//
// THIS SCREEN IS THE APPROVAL GATE, in the only form this feature has one.
// Every other AI surface in the product shows a teacher a draft they must
// accept; weekly summaries go straight to parents (phase-5.md D16), so the
// school's decision to switch it on is the whole control. Three things follow
// from that, and none of them are decoration:
//
//   * The copy states plainly that notes are sent without review. An admin
//     who doesn't realise that cannot meaningfully consent to it.
//   * The recent-notes list sits directly under the toggle, so "what is this
//     actually writing about our children?" is answerable on the same screen
//     where it gets enabled — not somewhere else, later.
//   * "Generate now" exists so an admin can see real output BEFORE the first
//     Monday sweep, rather than finding out what it says at the same time as
//     the parents do.
export default function ParentSummariesSettingsPage() {
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "parent-summary.manage");

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [recent, setRecent] = useState<ParentSummaryRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await getParentSummarySettings();
      setEnabled(settings.enabled);
      setAiEnabled(settings.aiEnabled);
      setAiConfigured(settings.aiConfigured);
      // Independently fault-tolerant: a failure listing past notes must not
      // stop an admin reaching the switch — which, when the reason they came
      // here is to turn it OFF, is the one thing this page must never block.
      try {
        setRecent(await listParentSummaries(5));
      } catch {
        setRecent([]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
    else setLoading(false);
  }, [canManage, load]);

  async function onToggle(next: boolean): Promise<void> {
    setSaving(true);
    try {
      const updated = await updateParentSummarySettings({ enabled: next });
      setEnabled(updated.enabled);
      toast.success(
        updated.enabled
          ? "Weekly updates are on. The next one sends on Monday morning."
          : "Weekly updates are off. Nothing further will be sent.",
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function onRunNow(): Promise<void> {
    setRunning(true);
    try {
      const { queued } = await runParentSummariesNow();
      toast.success(
        queued === 0
          ? "Nothing to write for last week — no new results, absences or lateness recorded."
          : `Writing ${queued} update${queued === 1 ? "" : "s"}. They'll appear below shortly.`,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't start — try again.");
    } finally {
      setRunning(false);
    }
  }

  if (!canManage) {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
            Weekly parent updates
          </h1>
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
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
          Weekly parent updates
        </h1>
        <p className="text-sm text-muted-foreground">
          Every Monday morning, each child whose week had something in it — a new
          result, an absence, a late mark — gets a short note written for their
          parent, sent to the portal and by email.
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
          {/* Stated before the switch, not after it. */}
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              These notes are sent to parents without a teacher reading them first.
            </p>
            <p className="mt-1 text-muted-foreground">
              They are written from attendance and scores only, and never name a
              child or make a judgement your records don&apos;t support. Even so,
              read a few below before you leave this on — and switch it off here
              the moment it writes something you wouldn&apos;t send yourself.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-card p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Send weekly updates</span>
              <span className="text-xs text-muted-foreground">
                Off by default. Monday mornings, one note per child per week.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled === true}
              aria-label="Toggle weekly parent updates"
              disabled={saving}
              onClick={() => void onToggle(!enabled)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                enabled ? "bg-emerald-600" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
                  enabled ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          {/* Three states that otherwise look identical from here ("it's on
              but nothing arrives"), so each says which one it is. */}
          {enabled && !aiEnabled && (
            <p className="text-sm text-amber-700">
              AI is switched off for this school, so no updates will be written
              while that stays off.
            </p>
          )}
          {enabled && aiEnabled && !aiConfigured && (
            <p className="text-sm text-amber-700">
              AI isn&apos;t configured on this deployment yet, so no updates will
              be written. Nothing is wrong with your settings.
            </p>
          )}

          {enabled && aiEnabled && aiConfigured && (
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" disabled={running} onClick={() => void onRunNow()}>
                {running && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {running ? "Starting…" : "Write last week's updates now"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Doesn&apos;t re-send anything already written.
              </span>
            </div>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Recently sent</h2>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing sent yet.
              </p>
            ) : (
              recent.map((r) => (
                <article key={r.id} className="rounded-md border bg-card p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Week of {formatWeek(r.weekStart)}
                    {r.emailedAt ? " · emailed" : " · portal only"}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed">{r.summary}</p>
                </article>
              ))
            )}
          </section>

          <Button type="button" variant="ghost" className="self-start" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      )}
    </div>
  );
}

// weekStart is a DATE (no time-of-day, no zone) — parsed and formatted in UTC
// so an admin in Lagos sees the Monday the API meant, not the Sunday before
// it. Same reasoning as the portal's copy of this helper.
function formatWeek(weekStart: string | Date): string {
  const d =
    typeof weekStart === "string" ? new Date(`${weekStart.slice(0, 10)}T00:00:00Z`) : weekStart;
  return d.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
