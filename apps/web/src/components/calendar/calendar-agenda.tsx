"use client";

import {
  CALENDAR_CATEGORY_LABELS,
  formatCalendarMonth,
  formatCalendarRange,
  groupCalendarEntriesByMonth,
  type CalendarEntryDto,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";

// Phase 8 / CP1 — the agenda list (D30: an agenda grouped by month, not a month
// grid). Shared by the admin/bursar page and the teacher page; the portal and
// mobile render the same DTO with their own components.
//
// An unconfirmed national holiday is ALWAYS labelled "Expected": its date is an
// estimate awaiting the Ministry of Interior's announcement (D23/D24), and a
// family planning around it must be able to tell.
export function CalendarAgenda({ entries }: { entries: CalendarEntryDto[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
        Nothing on the calendar for this period.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groupCalendarEntriesByMonth(entries).map((group) => (
        <section key={group.month} aria-label={formatCalendarMonth(`${group.month}-01`)}>
          <h2 className="mb-2 font-serif text-lg font-medium text-foreground">
            {formatCalendarMonth(`${group.month}-01`)}
          </h2>
          <ul className="flex flex-col divide-y rounded-md border bg-card">
            {group.entries.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="w-full shrink-0 text-sm text-muted-foreground sm:w-56">
                  {formatCalendarRange(e.startDate, e.endDate)}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{e.title}</span>
                    <Badge variant={e.source === "NATIONAL" ? "secondary" : "muted"}>
                      {CALENDAR_CATEGORY_LABELS[e.category]}
                    </Badge>
                    {!e.dateConfirmed && (
                      <Badge variant="warning" title="Date not yet announced by the Federal Government">
                        Expected
                      </Badge>
                    )}
                  </div>
                  {e.description && (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{e.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
