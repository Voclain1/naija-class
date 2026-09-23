// Small time helpers shared by every home screen.
//
// Lifted out of app/staff/index.tsx when the family homes needed the same
// three (2026-09-23): a greeting, the ISO weekday of the school's "today",
// and a long date. Dates arrive as YYYY-MM-DD from the server's own clock
// (serverToday), so they are read in UTC deliberately — parsing them in the
// device's zone is how a phone an hour behind shows yesterday.

export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a YYYY-MM-DD date, or null. */
export function isoWeekdayOf(date: string | null): number | null {
  if (date === null) return null;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  const day = new Date(parsed).getUTCDay();
  return day === 0 ? 7 : day;
}

/** "Wednesday, 23 September" — the school's date, never the handset's. */
export function formatLongDate(date: string | null): string | null {
  if (date === null) return null;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** Minutes since midnight, for "which lesson is on now" — the timetable's unit. */
export function nowMinutesOfDay(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}
