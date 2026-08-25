// The server's idea of "today", for the CP2 attendance rail.
//
// WHY NOT THE DEVICE CLOCK: the CP2 marking rail (see below) is a safety
// default during a real pilot with a real teacher. A rail that reads the
// handset's own clock is a rail the handset can walk around by accident — a
// phone with a wrong date would silently mark the wrong calendar day, and the
// teacher would have no way to see that had happened.
//
// WHERE THE SERVER TIME COMES FROM: every HTTP response carries a `Date`
// header (RFC 9110 §6.6.1 makes it mandatory for an origin server with a
// clock). apiFetch records it on every call, so by the time any attendance
// screen renders, at least one authenticated request has already established
// the server's clock. This deliberately adds NO endpoint — CP2's scope
// boundary is that it changes nothing server-side, and a "what time is it"
// route would breach that for information the transport already carries.
//
// DRIFT: we store the server instant alongside the local instant at which it
// was observed, then advance it by locally-elapsed time. A device clock that
// is wrong by days therefore still yields the right server date; only the
// small elapsed delta rides on the local clock.
//
// TIMEZONE: UTC, matching the rest of the attendance path. `AttendanceRecord.
// date` is `@db.Date` (no timezone), `parseIsoDate` builds UTC midnight, and
// the server's own future-date rejection in `resolveTermForDate` compares
// against UTC midnight. Deriving "today" in any other zone would put this rail
// and the server's own check on different calendars — the exact "midnight in
// which zone?" trap CLAUDE.md's @db.Date convention exists to avoid. Nigeria
// is UTC+1 with no DST, so the two agree throughout a school day; they differ
// only between 00:00 and 01:00 Lagos time, when nobody is marking a register.

interface ServerClock {
  serverMs: number;
  observedLocalMs: number;
}

let clock: ServerClock | null = null;

/** Record the `Date` header from any API response. Ignores an unparseable one. */
export function recordServerDate(header: string | null): void {
  if (!header) return;
  const serverMs = Date.parse(header);
  if (Number.isNaN(serverMs)) return;
  clock = { serverMs, observedLocalMs: Date.now() };
}

/** Test seam: forget the observed clock. */
export function resetServerClock(): void {
  clock = null;
}

/**
 * The server's current instant, or null if no response has been seen yet.
 * Never falls back to the device clock — a caller that needs to distinguish
 * "no server time yet" from a real answer must be able to.
 */
export function serverNowMs(): number | null {
  if (!clock) return null;
  return clock.serverMs + (Date.now() - clock.observedLocalMs);
}

/** YYYY-MM-DD for a UTC instant. */
export function isoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The server's today as YYYY-MM-DD, or null if the clock is not established. */
export function serverToday(): string | null {
  const ms = serverNowMs();
  return ms === null ? null : isoDateUtc(ms);
}
