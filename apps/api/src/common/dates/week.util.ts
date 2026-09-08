// Shared UTC calendar helpers.
//
// UTC, not local time, and not Africa/Lagos. These back date-bucketed
// aggregates whose boundaries derive from `@db.Date` columns (Term.startDate,
// AttendanceRecord.date), which carry no timezone at all — see CLAUDE.md's
// "midnight in which zone?" rule. Using local-time mutators (setHours/getDay/
// setDate) would compare against the wrong calendar day whenever the server's
// local timezone isn't UTC+0, which is exactly the trap that rule exists to
// avoid.
//
// The deliberate contrast is `docs/modules/bursar-dashboard.md` D2, which
// picks Africa/Lagos for the bursar's *daily* cash-drawer view because that is
// a school-day boundary. These helpers serve accounting-period boundaries
// (terms, budget windows), which is the other side of that same test — see
// `docs/modules/revenue-trajectory.md` D1 for the full reasoning.
//
// Lifted out of dashboard.service.ts (which now imports them) when the
// revenue trajectory became a second caller. Deliberately NOT re-implemented
// there: two week-bucketing functions that could drift apart would put the
// attendance trend and the finance trajectory on different calendars.

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight UTC on the calendar day containing `d`. */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Monday of the ISO week containing `d`, at UTC midnight. */
export function weekStart(d: Date): Date {
  const out = startOfDay(d);
  const day = out.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  out.setUTCDate(out.getUTCDate() + diff);
  return out;
}

/** `d` as a YYYY-MM-DD string, read in UTC. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
