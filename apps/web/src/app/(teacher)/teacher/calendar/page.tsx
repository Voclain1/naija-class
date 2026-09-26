"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { defaultCalendarWindow, formatCalendarRange, type CalendarEntryDto } from "@school-kit/types";

import { CalendarView } from "@/components/calendar/calendar-view";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { getCalendar } from "@/lib/calendar/calendar-api";

// /teacher/calendar — Phase 8 / CP1. Read-only (D28: teachers hold
// calendar-event.read and nothing else). The same merged calendar the rest of
// the school sees (D27).
export default function TeacherCalendarPage() {
  const calendarWindow = useMemo(() => defaultCalendarWindow(), []);
  const [entries, setEntries] = useState<CalendarEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries((await getCalendar(calendarWindow)).entries);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the calendar.");
    } finally {
      setLoading(false);
    }
  }, [calendarWindow]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          {formatCalendarRange(calendarWindow.from, calendarWindow.to)} · public holidays, term dates and school events.
        </p>
      </header>
      {error && <InlineAlert action={{ label: "Try again", onClick: () => void load() }}>{error}</InlineAlert>}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading calendar…
        </div>
      ) : (
        !error && <CalendarView entries={entries} />
      )}
    </div>
  );
}
