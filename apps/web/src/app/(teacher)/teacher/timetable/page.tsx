"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ISO_WEEKDAY_LABELS, formatMinuteOfDay, type TeacherTimetableDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { getMyTimetable } from "@/lib/timetable/timetable-api";
import { buildGrid } from "@/lib/timetable/timetable-grid";

// /teacher/timetable — Phase 8 / CP4 (docs/modules/phase-8.md §18 D37, Q38).
//
// Read-only. Two sections: "My lessons" (every lesson this teacher teaches, in
// the timetable in force for the chosen term, day by day) and, for a form
// teacher, the full grid of their form class(es). No other class's grid.
// Teachers see the LIVE timetable — the one the school is actually following —
// not the published snapshot families see (D45).

export default function TeacherTimetablePage() {
  const [termId, setTermId] = useState<string | undefined>(undefined);
  const [data, setData] = useState<TeacherTimetableDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getMyTimetable(termId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your timetable.");
    } finally {
      setLoading(false);
    }
  }, [termId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<number, TeacherTimetableDto["ownLessons"]>();
    for (const l of data?.ownLessons ?? []) m.set(l.dayOfWeek, [...(m.get(l.dayOfWeek) ?? []), l]);
    return m;
  }, [data]);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">My timetable</h1>
          <p className="text-sm text-muted-foreground">
            {data?.term ? `Your lessons for ${data.term.name}.` : "Your lessons across your classes."}
          </p>
        </div>
        {data && data.terms.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Term</span>
            <select
              aria-label="Term"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={data.term?.id ?? ""}
              onChange={(e) => setTermId(e.target.value)}
            >
              {data.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isCurrent ? " (current)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {error && <InlineAlert>{error}</InlineAlert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : !data ? null : !data.term ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          Your school hasn&apos;t set the current term yet.
        </div>
      ) : (
        <>
          <section aria-labelledby="my-lessons" className="flex flex-col gap-3">
            <h2 id="my-lessons" className="text-lg font-medium">
              My lessons
            </h2>
            {data.ownLessons.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                You have no lessons on the timetable for {data.term.name}.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.schoolWeekDays
                  .filter((d) => byDay.has(d))
                  .map((d) => (
                    <div key={d} className="rounded-md border bg-card p-3">
                      <h3 className="mb-2 text-sm font-medium">{ISO_WEEKDAY_LABELS[d]}</h3>
                      <ol className="flex flex-col gap-2">
                        {byDay.get(d)!.map((l) => (
                          <li key={`${d}-${l.slot.position}`} className="flex flex-col rounded bg-primary/10 p-2 text-sm">
                            <span className="text-xs text-muted-foreground">
                              {l.slot.label} · {formatMinuteOfDay(l.slot.startMinute)}–{formatMinuteOfDay(l.slot.endMinute)}
                            </span>
                            <span className="font-medium">
                              {l.subjectName} — {l.className}
                            </span>
                            {l.coTeacherNames.length > 0 && (
                              <span className="text-xs text-muted-foreground">With {l.coTeacherNames.join(", ")}</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
              </div>
            )}
          </section>

          {data.formClasses.map((fc) => {
            const grid = buildGrid(
              data.slots.map((s) => ({ ...s, lessonCount: 0 })),
              data.schoolWeekDays,
              fc.lessons,
            );
            return (
              <section key={fc.classArmId} aria-labelledby={`form-${fc.classArmId}`} className="flex flex-col gap-3">
                <h2 id={`form-${fc.classArmId}`} className="text-lg font-medium">
                  {fc.className} — your form class
                </h2>
                {fc.lessons.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                    {fc.className} has no timetable for {data.term!.name} yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border bg-card">
                    <table className="w-full border-collapse text-sm" aria-label={`${fc.className} timetable`}>
                      <thead>
                        <tr>
                          <th className="w-28 border-b p-2 text-left font-medium text-muted-foreground">Period</th>
                          {data.schoolWeekDays.map((d) => (
                            <th key={d} className="border-b border-l p-2 text-left font-medium">
                              {ISO_WEEKDAY_LABELS[d]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.slots.map((slot, si) => (
                          <tr key={slot.id}>
                            <th scope="row" className="border-b p-2 text-left align-top font-normal">
                              <div className="font-medium">{slot.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatMinuteOfDay(slot.startMinute)}–{formatMinuteOfDay(slot.endMinute)}
                              </div>
                            </th>
                            {slot.kind !== "LESSON" ? (
                              <td colSpan={data.schoolWeekDays.length} className="border-b border-l bg-muted/40 p-2 text-center text-xs uppercase tracking-wide text-muted-foreground">
                                {slot.label}
                              </td>
                            ) : (
                              data.schoolWeekDays.map((d, di) => {
                                const cell = grid[si]![di]!;
                                if (cell.type === "covered") return null;
                                if (cell.type === "lesson") {
                                  return (
                                    <td key={d} rowSpan={cell.rowSpan} className="border-b border-l p-1 align-top">
                                      <div className="rounded bg-primary/10 p-2">
                                        <div className="font-medium">{cell.lesson.subjectName}</div>
                                        <div className="text-xs text-muted-foreground">
                                          {cell.lesson.teachers.length ? cell.lesson.teachers.map((t) => t.name).join(", ") : "No teacher"}
                                        </div>
                                      </div>
                                    </td>
                                  );
                                }
                                return <td key={d} className="border-b border-l p-1" />;
                              })
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
