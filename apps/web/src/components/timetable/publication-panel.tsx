"use client";

import { useState } from "react";
import { toast } from "sonner";

import { describeTimetableClash, formatCalendarDate, type TimetableClashDto, type TimetableViewDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { publishTimetable, withdrawPublication } from "@/lib/timetable/timetable-api";

// Phase 8 / CP4 — what families see (docs/modules/phase-8.md §18 D45).
//
// Three states, always shown, in words:
//   Not published       — families can't see this timetable;
//   Published, up to date;
//   Unpublished changes — families still see the version published on <date>.
// Publishing is refused while this class is in a clash; the clashes are listed.

export function PublicationPanel({
  view,
  className,
  termName,
  canManage,
  onChanged,
}: {
  view: TimetableViewDto;
  className: string;
  termName: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<TimetableClashDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { state, publishedAt } = view.publication;
  const date = publishedAt ? formatCalendarDate(publishedAt.slice(0, 10)) : null;

  async function publish() {
    if (!view.inForce) return;
    setBusy(true);
    setBlocked(null);
    setError(null);
    try {
      const r = await publishTimetable(view.inForce.id);
      toast.success(`Published for ${r.terms.map((t) => t.name).join(", ")}. Families can see it now.`);
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === "PUBLISH_BLOCKED_BY_CLASH") {
        setBlocked((e.details as { clashes: TimetableClashDto[] }).clashes);
      } else {
        setError(e instanceof ApiError ? e.message : "Could not publish the timetable.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!window.confirm(`Withdraw ${className}'s ${termName} timetable? Families will no longer see it.`)) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawPublication({ classArmId: view.classArmId, termId: view.termId });
      toast.success("Withdrawn. Families can no longer see this timetable.");
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not withdraw the timetable.");
    } finally {
      setBusy(false);
    }
  }

  const tone =
    state === "UNPUBLISHED_CHANGES"
      ? "border-amber-500/50 bg-amber-500/10"
      : state === "UP_TO_DATE"
        ? "border-primary/30 bg-primary/5"
        : "border-dashed bg-muted/30";

  return (
    <section aria-label="What families see" className={`flex flex-col gap-3 rounded-md border p-4 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status">
          {state === "NOT_PUBLISHED" && <>Not published — students and parents can&apos;t see this timetable for {termName}.</>}
          {state === "UP_TO_DATE" && <>Published {date} — students and parents see exactly this.</>}
          {state === "UNPUBLISHED_CHANGES" && <>Unpublished changes — students and parents still see the version published on {date}.</>}
        </p>
        {canManage && (
          <div className="flex gap-2">
            {view.inForce && view.lessons.length > 0 && state !== "UP_TO_DATE" && (
              <Button type="button" size="sm" onClick={() => void publish()} disabled={busy}>
                {state === "UNPUBLISHED_CHANGES" ? "Publish changes" : "Publish"}
              </Button>
            )}
            {state !== "NOT_PUBLISHED" && (
              <Button type="button" size="sm" variant="ghost" onClick={() => void withdraw()} disabled={busy}>
                Withdraw
              </Button>
            )}
          </div>
        )}
      </div>
      {blocked && (
        <InlineAlert title="Not published — resolve these clashes first">
          <ul className="list-disc pl-4">
            {blocked.map((c) => (
              <li key={`${c.teacherId}-${c.dayOfWeek}-${c.bellSlotId}-${c.termId}`}>{describeTimetableClash(c)}</li>
            ))}
          </ul>
        </InlineAlert>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
    </section>
  );
}
