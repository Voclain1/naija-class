"use client";

import { Eye, EyeOff, Loader2, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  CALENDAR_CATEGORY_LABELS,
  defaultCalendarWindow,
  formatCalendarRange,
  type CalendarEntryDto,
  type ManagedNationalEventDto,
  type SchoolEventDto,
} from "@school-kit/types";

import { CalendarView } from "@/components/calendar/calendar-view";
import { SchoolEventFormModal, type SchoolEventFormValues } from "@/components/calendar/school-event-form-modal";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import {
  createSchoolEvent,
  deleteSchoolEvent,
  getCalendar,
  hideNationalEvent,
  listNationalEvents,
  listSchoolEvents,
  unhideNationalEvent,
  updateSchoolEvent,
} from "@/lib/calendar/calendar-api";

// Duplicated per-file rather than a shared hook — same pattern as the settings
// screens. See docs/deferred.md ("Shared usePermissions hook").
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

// /events — Phase 8 / CP1 Event Calendar (docs/modules/phase-8.md §15).
//
// Owner/admin see the calendar plus management; bursar sees the same calendar
// read-only (D30). Controls are hidden by permission for clarity only — the API
// enforces every write regardless (D28).
//
// There are deliberately no create/edit controls for public holidays. They are
// platform data no runtime path can write (D22); a school can only hide one from
// its own calendar (D19).
export default function EventsPage() {
  const { permissions } = useAuth();
  const canRead = hasPermission(permissions, "calendar-event.read");
  const canManage = hasPermission(permissions, "calendar-event.create");
  const canHide = hasPermission(permissions, "national-event.hide");

  const calendarWindow = useMemo(() => defaultCalendarWindow(), []);

  const [entries, setEntries] = useState<CalendarEntryDto[]>([]);
  const [schoolEvents, setSchoolEvents] = useState<SchoolEventDto[]>([]);
  const [nationalEvents, setNationalEvents] = useState<ManagedNationalEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolEventDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cal, school, national] = await Promise.all([
        getCalendar(calendarWindow),
        canManage ? listSchoolEvents(calendarWindow) : Promise.resolve<SchoolEventDto[]>([]),
        canHide ? listNationalEvents(calendarWindow) : Promise.resolve<ManagedNationalEventDto[]>([]),
      ]);
      setEntries(cal.entries);
      setSchoolEvents(school);
      setNationalEvents(national);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the calendar.");
    } finally {
      setLoading(false);
    }
  }, [calendarWindow, canManage, canHide]);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  async function save(values: SchoolEventFormValues) {
    if (editing) {
      await updateSchoolEvent(editing.id, values);
      toast.success("Event updated.");
    } else {
      await createSchoolEvent(values);
      toast.success("Event added.");
    }
    setFormOpen(false);
    setEditing(null);
    await load();
  }

  async function remove(event: SchoolEventDto) {
    if (!window.confirm(`Delete "${event.title}"? Everyone at your school will stop seeing it.`)) return;
    setBusyId(event.id);
    try {
      await deleteSchoolEvent(event.id);
      toast.success("Event deleted.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete the event.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleHidden(n: ManagedNationalEventDto) {
    setBusyId(n.id);
    try {
      if (n.hidden) {
        await unhideNationalEvent(n.id);
        toast.success(`${n.name} is back on your school's calendar.`);
      } else {
        await hideNationalEvent(n.id);
        toast.success(`${n.name} is hidden from your school's calendar.`);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update the holiday.");
    } finally {
      setBusyId(null);
    }
  }

  if (!canRead) {
    return (
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Event Calendar</h1>
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          You don&apos;t have access to the calendar.
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Event Calendar</h1>
          <p className="text-sm text-muted-foreground">
            {formatCalendarRange(calendarWindow.from, calendarWindow.to)} · public holidays, term dates and your
            school&apos;s events.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <PlusCircle className="h-4 w-4" />
            Add event
          </Button>
        )}
      </header>

      {error && (
        <InlineAlert action={{ label: "Try again", onClick: () => void load() }}>{error}</InlineAlert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading calendar…
        </div>
      ) : error ? null : (
        <>
          <CalendarView entries={entries} />

          {canManage && (
            <section className="flex flex-col gap-3" aria-labelledby="school-events-heading">
              <h2 id="school-events-heading" className="font-serif text-xl font-medium text-foreground">
                Your school&apos;s events
              </h2>
              {schoolEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events added for this period yet.</p>
              ) : (
                <ul className="flex flex-col divide-y rounded-md border bg-card">
                  {schoolEvents.map((e) => (
                    <li key={e.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-col">
                        <span className="font-medium text-foreground">{e.title}</span>
                        <span className="text-sm text-muted-foreground">
                          {formatCalendarRange(e.startDate, e.endDate)} · {CALENDAR_CATEGORY_LABELS[e.category]}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Edit ${e.title}`}
                          onClick={() => {
                            setEditing(e);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Delete ${e.title}`}
                          disabled={busyId === e.id}
                          onClick={() => void remove(e)}
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {canHide && (
            <section className="flex flex-col gap-3" aria-labelledby="national-heading">
              <div className="flex flex-col gap-1">
                <h2 id="national-heading" className="font-serif text-xl font-medium text-foreground">
                  Public holidays
                </h2>
                <p className="text-sm text-muted-foreground">
                  Set nationally. You can hide one from your school&apos;s calendar — for example if your school opens
                  that day — but its date can&apos;t be changed here.
                </p>
              </div>
              <ul className="flex flex-col divide-y rounded-md border bg-card">
                {nationalEvents.map((n) => (
                  <li key={n.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={n.hidden ? "text-muted-foreground line-through" : "font-medium text-foreground"}>
                          {n.name}
                        </span>
                        {!n.dateConfirmed && <Badge variant="warning">Expected</Badge>}
                        {n.hidden && <Badge variant="muted">Hidden from your school</Badge>}
                      </div>
                      <span className="text-sm text-muted-foreground">{formatCalendarRange(n.startDate, n.endDate)}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === n.id}
                      aria-label={n.hidden ? `Show ${n.name}` : `Hide ${n.name}`}
                      onClick={() => void toggleHidden(n)}
                    >
                      {n.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      {n.hidden ? "Show" : "Hide"}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <SchoolEventFormModal
        open={formOpen}
        editing={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={save}
      />
    </div>
  );
}
