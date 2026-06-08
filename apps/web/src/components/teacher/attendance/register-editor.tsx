"use client";

import { Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { AttendanceRegisterResponse, AttendanceStatusDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { getRegister, markAttendance } from "@/lib/attendance/attendance-api";
import { cn } from "@/lib/utils";

import { STATUS_META, STATUS_ORDER } from "./status-meta";

interface Props {
  classArmId: string;
  date: string; // YYYY-MM-DD
  // Reports the latest markedAt across the loaded register (null when the date
  // has no marks, or the load failed) so the page can show the "Last marked at"
  // stamp up in its header section. Fired on every (re)load — incl. after a save.
  onLoaded?: (meta: { lastMarkedAt: Date | null }) => void;
}

interface Row {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  status: AttendanceStatusDto | null;
  note: string;
}

type Loaded = {
  termId: string;
  rows: Row[];
  // studentId → the as-loaded {status, note}, for dirty comparison.
  initial: Map<string, { status: AttendanceStatusDto | null; note: string }>;
  lastMarkedAt: Date | null;
};

type Status =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "no-term" } // server 400 — date in the future or outside any term
  | { kind: "ready"; data: Loaded };

function buildLoaded(res: AttendanceRegisterResponse): Loaded {
  const rows: Row[] = res.records.map((r) => ({
    studentId: r.studentId,
    fullName: r.fullName,
    admissionNumber: r.admissionNumber,
    status: r.status,
    note: r.note ?? "",
  }));
  const initial = new Map(rows.map((r) => [r.studentId, { status: r.status, note: r.note }]));
  const stamps = res.records
    .map((r) => (r.markedAt ? new Date(r.markedAt) : null))
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  const lastMarkedAt = stamps.length > 0 ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null;
  return { termId: res.termId, rows, initial, lastMarkedAt };
}

// The roster grid for one (arm × date). Owns the edit state; fetches the
// register itself so the parent only has to pick the arm + date. Save sends
// ONLY the changed rows (dirty-only, like the gradebook) → the bulk endpoint,
// which means a single re-mark touches one row and writes one audit entry.
export function RegisterEditor({ classArmId, date, onLoaded }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      const res = await getRegister(classArmId, date);
      const data = buildLoaded(res);
      setStatus({ kind: "ready", data });
      onLoaded?.({ lastMarkedAt: data.lastMarkedAt });
    } catch (e) {
      onLoaded?.({ lastMarkedAt: null });
      if (e instanceof ApiError && e.status === 400) {
        setStatus({ kind: "no-term" });
        return;
      }
      setStatus({
        kind: "error",
        message: e instanceof ApiError ? e.message : "Could not load the register.",
      });
    }
  }, [classArmId, date, onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchRow(studentId: string, patch: Partial<Row>): void {
    setStatus((prev) => {
      if (prev.kind !== "ready") return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          rows: prev.data.rows.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r)),
        },
      };
    });
  }

  // "Mark all present" — sets every UNMARKED student to PRESENT; never overrides
  // an existing mark.
  function markAllPresent(): void {
    setStatus((prev) => {
      if (prev.kind !== "ready") return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          rows: prev.data.rows.map((r) => (r.status === null ? { ...r, status: "PRESENT" } : r)),
        },
      };
    });
  }

  const data = status.kind === "ready" ? status.data : null;
  // Sendable changes: rows whose status/note differ from load AND now carry a
  // status (the API requires a status per row — a note alone can't be saved).
  const dirty =
    data?.rows.filter((r) => {
      const init = data.initial.get(r.studentId);
      const changed = !init || init.status !== r.status || init.note !== r.note;
      return changed && r.status !== null;
    }) ?? [];
  const canSave = dirty.length > 0 && !saving;

  async function onSave(): Promise<void> {
    if (!data || dirty.length === 0) return;
    setSaving(true);
    try {
      const result = await markAttendance(
        classArmId,
        date,
        dirty.map((r) => ({ studentId: r.studentId, status: r.status as AttendanceStatusDto, note: r.note.trim() || null })),
      );
      toast.success(`Attendance saved for ${result.count} student${result.count === 1 ? "" : "s"}.`);
      await load(); // refresh marks + last-marked stamp, clears dirty
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        const ids = (e.details as { invalidStudentIds?: string[] } | undefined)?.invalidStudentIds;
        if (Array.isArray(ids) && ids.length > 0) {
          const names = ids.map((id) => data.rows.find((r) => r.studentId === id)?.fullName ?? id);
          toast.error(`Not on today's register: ${names.join(", ")}. Reload and try again.`);
        } else {
          toast.error(e.message || "Couldn't save attendance.");
        }
      } else {
        toast.error(e instanceof ApiError ? e.message : "Couldn't save attendance — try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (status.kind === "loading") {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted/50" />
        ))}
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {status.message}
      </div>
    );
  }

  if (status.kind === "no-term") {
    return (
      <div className="rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800">
        This date isn&apos;t within any term. Pick a date during a term.
      </div>
    );
  }

  if (status.data.rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No students enrolled.</p>
        <p className="mt-1">No students are enrolled in this arm for this date.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The "Last marked at HH:MM" stamp lives in the page header (lifted via
          onLoaded) — here we keep just the actions. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={markAllPresent}>
          Mark all present
        </Button>
        <Button type="button" disabled={!canSave} onClick={onSave}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Student</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {status.data.rows.map((row) => (
              <tr key={row.studentId} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">{row.fullName}</div>
                  <div className="text-xs text-muted-foreground">{row.admissionNumber}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="inline-flex overflow-hidden rounded-md border">
                    {STATUS_ORDER.map((s) => {
                      const meta = STATUS_META[s];
                      const active = row.status === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-label={`${row.fullName} ${meta.full}`}
                          aria-pressed={active}
                          title={meta.full}
                          onClick={() => patchRow(row.studentId, { status: s })}
                          className={cn(
                            "h-8 w-9 border-r text-xs font-semibold transition-colors last:border-r-0",
                            active
                              ? meta.active
                              : "bg-background text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {meta.letter}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-label={`Note for ${row.fullName}`}
                    value={row.note}
                    maxLength={500}
                    placeholder="Optional note"
                    disabled={saving}
                    className="h-8 w-full max-w-xs"
                    onChange={(e) => patchRow(row.studentId, { note: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dirty.length > 0 && (
        <p className="inline-flex items-center gap-1.5 text-xs text-amber-700">
          <Check className="h-3.5 w-3.5" />
          {dirty.length} unsaved change{dirty.length === 1 ? "" : "s"}.
        </p>
      )}
    </div>
  );
}
