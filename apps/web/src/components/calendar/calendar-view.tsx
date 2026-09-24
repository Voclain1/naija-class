"use client";

import { useState } from "react";
import { lagosTodayIso, type CalendarEntryDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { CalendarAgenda } from "@/components/calendar/calendar-agenda";
import { CalendarMonth } from "@/components/calendar/calendar-month";

// The calendar in the two shapes people expect, matching the app exactly
// (2026-09-23): a month grid by default, and the agenda list as the second
// view.
//
// MONTH is the default because a calendar question is usually about a date —
// is the 16th free, when does the break start — and a list makes you count.
// LIST stays because it answers "what is coming up" without clicking through
// days, and reads in order for a screen reader, which a grid does not.
//
// Shared by the admin events page and the teacher calendar so a holiday looks
// the same to a head and to a teacher; the two differ only in whether the
// management controls are on the page.

export function CalendarView({
  entries,
  onChangeMonth,
}: {
  entries: CalendarEntryDto[];
  onChangeMonth?: (month: string) => void;
}) {
  const [view, setView] = useState<"month" | "list">("month");
  // The school's day, read as a calendar date and never shifted by the
  // browser's timezone — the same rule the @db.Date convention follows.
  const today = lagosTodayIso();

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={view === "month" ? "default" : "outline"} onClick={() => setView("month")}>
          Month
        </Button>
        <Button size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}>
          List
        </Button>
      </div>
      {view === "month" ? (
        <CalendarMonth entries={entries} today={today} {...(onChangeMonth ? { onChangeMonth } : {})} />
      ) : (
        <CalendarAgenda entries={entries} />
      )}
    </div>
  );
}
