"use client";

import { ArrowDown, ArrowUp, Loader2, PlusCircle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  BELL_SLOT_KINDS,
  ISO_WEEKDAY_LABELS,
  formatMinuteOfDay,
  parseMinuteOfDay,
  saveBellScheduleSchema,
  type BellSlotDto,
  type BellSlotKind,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { getBellSchedule, saveBellSchedule } from "@/lib/timetable/timetable-api";

// Duplicated per-file rather than a shared hook — same pattern as the settings
// screens. See docs/deferred.md ("Shared usePermissions hook").
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

// /settings/bell-schedule — Phase 8 / CP3 (docs/modules/phase-8.md §17 D26, D34, D36).
//
// ONE bell schedule per school: the ordered periods every class shares, and the
// days the school meets. Saved as a whole. The API refuses removing a period —
// or making it a break — while lessons use it, and names how many.

const KIND_LABELS: Record<BellSlotKind, string> = {
  LESSON: "Lesson",
  BREAK: "Break",
  ASSEMBLY: "Assembly",
  OTHER: "Other",
};

interface Row {
  key: string;
  id?: string;
  label: string;
  kind: BellSlotKind;
  start: string; // "HH:MM"
  end: string;
  lessonCount: number;
}

const FIELD =
  "h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

let keySeq = 0;
const toRow = (s: BellSlotDto): Row => ({
  key: s.id,
  id: s.id,
  label: s.label,
  kind: s.kind,
  start: formatMinuteOfDay(s.startMinute),
  end: formatMinuteOfDay(s.endMinute),
  lessonCount: s.lessonCount,
});

export default function BellSchedulePage() {
  const { permissions } = useAuth();
  const canRead = hasPermission(permissions, "timetable.read");
  const canManage = hasPermission(permissions, "timetable.manage");

  const [rows, setRows] = useState<Row[]>([]);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getBellSchedule();
      setRows(s.slots.map(toRow));
      setDays(s.schoolWeekDays);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the bell schedule.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, by: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row!);
      return next;
    });

  function addPeriod() {
    setRows((rs) => {
      const last = rs[rs.length - 1];
      const start = last ? (parseMinuteOfDay(last.end) ?? 480) : 480;
      const lessons = rs.filter((r) => r.kind === "LESSON").length;
      return [
        ...rs,
        {
          key: `new-${++keySeq}`,
          label: `Period ${lessons + 1}`,
          kind: "LESSON",
          start: formatMinuteOfDay(Math.min(start, 1400)),
          end: formatMinuteOfDay(Math.min(start + 40, 1439)),
          lessonCount: 0,
        },
      ];
    });
  }

  async function save() {
    setError(null);
    const slots = [];
    for (const r of rows) {
      const startMinute = parseMinuteOfDay(r.start);
      const endMinute = parseMinuteOfDay(r.end);
      if (startMinute === null || endMinute === null) {
        setError(`Enter a start and end time for ${r.label || "every period"}.`);
        return;
      }
      slots.push({ ...(r.id ? { id: r.id } : {}), label: r.label, kind: r.kind, startMinute, endMinute });
    }
    const parsed = saveBellScheduleSchema.safeParse({ slots, schoolWeekDays: days });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the periods and try again.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveBellSchedule(parsed.data);
      setRows(saved.slots.map(toRow));
      setDays(saved.schoolWeekDays);
      toast.success("Bell schedule saved.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the bell schedule.");
    } finally {
      setSaving(false);
    }
  }

  if (!canRead) {
    return (
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Bell schedule</h1>
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          You don&apos;t have access to the bell schedule.
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Bell schedule</h1>
        <p className="text-sm text-muted-foreground">
          The periods of the school day, shared by every class. Build class timetables on the{" "}
          <Link href="/timetable" className="text-primary underline-offset-4 hover:underline">
            Timetable
          </Link>{" "}
          page.
        </p>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : (
        <>
          <section aria-labelledby="school-week" className="flex flex-col gap-3 rounded-md border bg-card p-4">
            <h2 id="school-week" className="text-sm font-medium">
              School week
            </h2>
            <div className="flex flex-wrap gap-3">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={days.includes(d)}
                    disabled={!canManage}
                    onChange={(e) =>
                      setDays((ds) => (e.target.checked ? [...ds, d].sort((a, b) => a - b) : ds.filter((x) => x !== d)))
                    }
                  />
                  {ISO_WEEKDAY_LABELS[d]}
                </label>
              ))}
            </div>
          </section>

          <section aria-labelledby="periods" className="flex flex-col gap-3 rounded-md border bg-card p-4">
            <h2 id="periods" className="text-sm font-medium">
              Periods
            </h2>
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">No periods yet. Add the first period of the day.</p>
            )}
            <ol className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <li key={r.key} className="flex flex-wrap items-end gap-2 rounded-md border bg-background p-2">
                  <label className="flex flex-1 flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">Name</span>
                    <input
                      aria-label={`Period ${i + 1} name`}
                      className={`${FIELD} min-w-[8rem]`}
                      value={r.label}
                      disabled={!canManage}
                      onChange={(e) => update(r.key, { label: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">Kind</span>
                    <select
                      aria-label={`Period ${i + 1} kind`}
                      className={FIELD}
                      value={r.kind}
                      disabled={!canManage}
                      onChange={(e) => update(r.key, { kind: e.target.value as BellSlotKind })}
                    >
                      {BELL_SLOT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">Starts</span>
                    <input
                      type="time"
                      aria-label={`Period ${i + 1} start`}
                      className={FIELD}
                      value={r.start}
                      disabled={!canManage}
                      onChange={(e) => update(r.key, { start: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">Ends</span>
                    <input
                      type="time"
                      aria-label={`Period ${i + 1} end`}
                      className={FIELD}
                      value={r.end}
                      disabled={!canManage}
                      onChange={(e) => update(r.key, { end: e.target.value })}
                    />
                  </label>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${r.label} up`}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={`Move ${r.label} down`}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        aria-label={`Remove ${r.label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  {r.lessonCount > 0 && (
                    <span className="basis-full text-xs text-muted-foreground">
                      {r.lessonCount} lesson{r.lessonCount === 1 ? "" : "s"} on the timetable
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={addPeriod}>
                  <PlusCircle className="mr-2 h-4 w-4" aria-hidden="true" /> Add period
                </Button>
                <Button type="button" onClick={() => void save()} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Save bell schedule
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
