"use client";

import { useMemo, useState } from "react";
import {
  CALENDAR_CATEGORY_LABELS,
  WEEKDAY_INITIALS,
  buildMonthGrid,
  entriesOnDate,
  formatCalendarRange,
  formatMonth,
  monthOf,
  shiftMonth,
  type CalendarEntryCategory,
  type CalendarEntryDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";

// The calendar as a MONTH GRID, matching the app (2026-09-23).
//
// This reverses phase-8 §15 D30's "agenda list grouped by month, not a month
// grid" for the web surfaces. The reason is what the app shipped and what
// people did with it: a calendar question is usually about a DATE — is the
// 16th free, when does the break start — and a list makes you count to answer
// it. The maintainer asked for the two to match after using both.
//
// The agenda list is kept, as the second view: it answers "what is coming up"
// without tapping through days, and it reads in order for a screen reader,
// which a grid does not.
//
// The grid maths is @school-kit/types' month-grid, the same module the app
// uses — a date grid is easy to get subtly wrong (a month starting on Sunday,
// a leap February, a multi-day event that must appear on every day it
// covers), and two implementations would drift.

const DOT_COLOURS: Record<string, string> = {
  HOLIDAY: "bg-rose-500",
  PUBLIC_HOLIDAY: "bg-rose-500",
  SPECIAL_HOLIDAY: "bg-rose-500",
  BREAK: "bg-amber-500",
  EXAM_PERIOD: "bg-violet-500",
  MEETING: "bg-sky-500",
  RESUMPTION: "bg-emerald-600",
  TERM_START: "bg-emerald-600",
  TERM_END: "bg-emerald-600",
};

function dotColour(category: CalendarEntryCategory): string {
  return DOT_COLOURS[category] ?? "bg-primary";
}

export function CalendarMonth({
  entries,
  today,
  onChangeMonth,
}: {
  entries: CalendarEntryDto[];
  /** The school's today (YYYY-MM-DD), so "today" is not the browser's idea of it. */
  today: string;
  /** Called when the visible month changes, so the page can widen its query. */
  onChangeMonth?: (month: string) => void;
}) {
  const [month, setMonth] = useState<string>(() => monthOf(today));
  const [selected, setSelected] = useState<string | null>(today);

  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const selectedEntries = useMemo(
    () => (selected ? entriesOnDate(entries, selected) : []),
    [entries, selected],
  );

  function goto(next: string): void {
    setMonth(next);
    // A date in the month being left would sit outside the grid.
    setSelected(null);
    onChangeMonth?.(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => goto(shiftMonth(month, -1))} aria-label="Previous month">
          ‹
        </Button>
        <p className="font-serif text-lg font-medium text-foreground">{formatMonth(month)}</p>
        <Button variant="outline" size="sm" onClick={() => goto(shiftMonth(month, 1))} aria-label="Next month">
          ›
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAY_INITIALS.map((initial, index) => (
            <div key={`${initial}-${index}`} className="py-1 text-xs font-semibold text-muted-foreground">
              {initial}
            </div>
          ))}
          {cells.map((cell) => {
            const dayEntries = entriesOnDate(entries, cell.date);
            const isSelected = cell.date === selected;
            const isToday = cell.date === today;
            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => setSelected(cell.date)}
                aria-label={`${cell.date}${dayEntries.length ? `, ${dayEntries.length} event(s)` : ""}`}
                aria-pressed={isSelected}
                className={[
                  "flex min-h-[3rem] flex-col items-center justify-center rounded-md py-1 text-sm transition",
                  isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  !isSelected && isToday ? "ring-1 ring-primary" : "",
                  // Days from neighbouring months stay visible but recede:
                  // hiding them would leave holes in the weeks.
                  cell.inMonth ? "" : "opacity-40",
                ].join(" ")}
              >
                <span className={isToday ? "font-semibold" : undefined}>{cell.dayOfMonth}</span>
                <span className="mt-0.5 flex h-1.5 gap-0.5">
                  {dayEntries.slice(0, 3).map((entry) => (
                    <span
                      key={entry.id}
                      className={[
                        "h-1.5 w-1.5 rounded-full",
                        isSelected ? "bg-primary-foreground" : dotColour(entry.category),
                      ].join(" ")}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium text-foreground">{formatCalendarRange(selected, selected)}</p>
          {selectedEntries.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Nothing on this day.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {selectedEntries.map((entry) => (
                <li key={entry.id}>
                  <p className="text-sm text-foreground">{entry.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {CALENDAR_CATEGORY_LABELS[entry.category]}
                    {entry.startDate === entry.endDate
                      ? ""
                      : ` · ${formatCalendarRange(entry.startDate, entry.endDate)}`}
                    {entry.dateConfirmed ? "" : " · date not confirmed"}
                  </p>
                  {entry.description && <p className="mt-0.5 text-xs text-muted-foreground">{entry.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
