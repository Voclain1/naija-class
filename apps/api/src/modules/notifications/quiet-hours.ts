// Quiet hours (docs/modules/notifications-v1.md N5).
//
// Nothing non-urgent is delivered between 21:00 and 06:00 in the school's
// time. A results notification at 23:40 wakes a house, and the person turns
// notifications off — which costs every later message, including the ones
// that matter. So a late notification is HELD and released at 06:00 rather
// than dropped: the news still arrives, at an hour a person can act on.
//
// Two things are deliberately NOT here:
//   - Fee reminders, which a human sends by pressing a button. The human
//     chose the moment; the system does not second-guess it.
//   - Anything marked urgent (announcements, A4), which is the whole point of
//     that flag.
//
// Nigeria is UTC+1 all year — no daylight saving — so the offset is a
// constant rather than a timezone database lookup. Stated as a named constant
// so it is a decision rather than a magic number.

export const LAGOS_UTC_OFFSET_HOURS = 1;
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 6;

/** The hour of day in Lagos for a given instant, 0–23. */
export function lagosHour(now: Date): number {
  return (now.getUTCHours() + LAGOS_UTC_OFFSET_HOURS) % 24;
}

export function isQuietHour(now: Date): boolean {
  const hour = lagosHour(now);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/**
 * How long to hold a notification, in milliseconds. 0 means send now.
 *
 * Returns the wait until the next 06:00 Lagos, so a 21:30 send waits ~8.5
 * hours and a 05:59 send waits a minute.
 */
export function quietHoursDelayMs(now: Date, urgent = false): number {
  if (urgent || !isQuietHour(now)) return 0;
  const lagosNow = new Date(now.getTime() + LAGOS_UTC_OFFSET_HOURS * 3_600_000);
  const release = new Date(lagosNow.getTime());
  release.setUTCHours(QUIET_END_HOUR, 0, 0, 0);
  // Before 06:00 the release is later today; from 21:00 it is tomorrow.
  if (release.getTime() <= lagosNow.getTime()) release.setUTCDate(release.getUTCDate() + 1);
  return release.getTime() - lagosNow.getTime();
}
