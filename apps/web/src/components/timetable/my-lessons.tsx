"use client";

import { useMemo, useState } from "react";
import { ISO_WEEKDAY_LABELS, formatMinuteOfDay, type TeacherTimetableDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";

// A teacher's own lessons as a DAY or a WEEK, matching the app's
// `app/staff/timetable/index.tsx` (2026-09-23). The web page previously had
// neither view — it listed every day at once as cards, which answers "what am
// I teaching today" only after you find today among five columns.
//
// WEEK is the default here where the app defaults to DAY, and that is the one
// deliberate divergence: the app's reason for defaulting to a day is that a
// week of readable cells does not fit a phone and has to scroll sideways. A
// desktop shows the whole week at once, so defaulting to a single day would
// hide information the screen has room for.
//
// Non-teaching slots (break, assembly) are dropped from the week grid, unlike
// the CLASS grid below it. A teacher's week is mostly empty space already, and
// a break row repeated across their free periods is noise; on a class
// timetable break is part of the day's shape, which is why that grid keeps it.

type Lesson = TeacherTimetableDto["ownLessons"][number];

function isoWeekdayToday(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

export function MyLessons({ data }: { data: TeacherTimetableDto }) {
  const today = isoWeekdayToday();
  const days = data.schoolWeekDays;
  const [view, setView] = useState<"week" | "day">("week");
  const [day, setDay] = useState<number>(() => (days.includes(today) ? today : (days[0] ?? 1)));

  // Only the slots somebody actually teaches in: a teacher's grid padded out
  // with the school's every period is mostly blank rows.
  const rows = useMemo(() => {
    const taught = new Set(data.ownLessons.map((l) => l.slot.position));
    return data.slots
      .filter((s) => s.kind === "LESSON" && taught.has(s.position))
      .sort((a, b) => a.startMinute - b.startMinute);
  }, [data]);

  const at = useMemo(() => {
    const m = new Map<string, Lesson>();
    for (const l of data.ownLessons) m.set(`${l.dayOfWeek}:${l.slot.position}`, l);
    return m;
  }, [data]);

  const dayLessons = useMemo(
    () => data.ownLessons.filter((l) => l.dayOfWeek === day).sort((a, b) => a.slot.startMinute - b.slot.startMinute),
    [data, day],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button size="sm" variant={view === "week" ? "default" : "outline"} onClick={() => setView("week")}>
          Week
        </Button>
        <Button size="sm" variant={view === "day" ? "default" : "outline"} onClick={() => setView("day")}>
          Day
        </Button>
      </div>

      {view === "week" ? (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full border-collapse text-sm" aria-label="My lessons this week">
            <thead>
              <tr>
                <th className="w-28 border-b p-2 text-left font-medium text-muted-foreground">Time</th>
                {days.map((d) => (
                  <th
                    key={d}
                    className={[
                      "border-b border-l p-2 text-left font-medium",
                      d === today ? "text-primary" : "",
                    ].join(" ")}
                    aria-current={d === today ? "date" : undefined}
                  >
                    {ISO_WEEKDAY_LABELS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((slot) => (
                <tr key={slot.id}>
                  <th scope="row" className="border-b p-2 text-left align-top font-normal">
                    <div className="font-medium">{slot.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatMinuteOfDay(slot.startMinute)}–{formatMinuteOfDay(slot.endMinute)}
                    </div>
                  </th>
                  {days.map((d) => {
                    const lesson = at.get(`${d}:${slot.position}`);
                    return (
                      <td key={d} className="border-b border-l p-1 align-top">
                        {lesson ? (
                          <div className="rounded bg-primary/10 p-2">
                            <div className="font-medium">{lesson.subjectName}</div>
                            <div className="text-xs text-muted-foreground">{lesson.className}</div>
                          </div>
                        ) : (
                          // A free period, said plainly: a blank cell reads as
                          // "not loaded" as easily as "nothing here".
                          <div className="p-2 text-xs text-muted-foreground">Free</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {days.map((d) => (
              <Button key={d} size="sm" variant={d === day ? "default" : "outline"} onClick={() => setDay(d)}>
                {ISO_WEEKDAY_LABELS[d]?.slice(0, 3) ?? d}
              </Button>
            ))}
          </div>
          {dayLessons.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
              Nothing on your timetable for {ISO_WEEKDAY_LABELS[day] ?? "this day"}.
            </div>
          ) : (
            <ol className="flex flex-col gap-2">
              {dayLessons.map((l) => (
                <li key={`${l.dayOfWeek}-${l.slot.position}`} className="rounded-md border bg-card p-3">
                  <p className="text-xs text-muted-foreground">
                    {l.slot.label} · {formatMinuteOfDay(l.slot.startMinute)}–{formatMinuteOfDay(l.slot.endMinute)}
                  </p>
                  <p className="font-medium">
                    {l.subjectName} — {l.className}
                  </p>
                  {l.coTeacherNames.length > 0 && (
                    <p className="text-xs text-muted-foreground">With {l.coTeacherNames.join(", ")}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
