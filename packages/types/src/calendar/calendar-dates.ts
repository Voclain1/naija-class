// Phase 8 / CP1 — calendar date helpers shared by apps/web, apps/portal and
// apps/mobile (docs/modules/phase-8.md §15 D29).
//
// "Today" for a school calendar is the school day in Nigeria, not the viewer's
// device clock and not UTC. The API itself never needs "today" — every calendar
// request names its window explicitly — so these live here, where all three
// clients compute the same default window.
//
// DELIBERATELY NO Intl. Formatting differs between Node, browsers and React
// Native's Hermes (en-GB inserts a comma after the weekday in some engines and
// not others), and Hermes' time-zone support is not something a date on a
// child's calendar should depend on. Nigeria is West Africa Time: a fixed
// UTC+01:00 with no daylight saving, so the offset is a constant.

const LAGOS_UTC_OFFSET_MS = 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Today's date in Lagos as YYYY-MM-DD. At 23:30 UTC on 31 Dec it is already 1 Jan in Lagos — Lagos is the day that counts. */
export function lagosTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + LAGOS_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** Adds whole days to a YYYY-MM-DD date, in calendar terms. */
export function addDaysIso(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The default agenda window: from the first day of the current Lagos month to
 * 180 days later. Starting at the month's start (not today) keeps a break that
 * began earlier this month visible; 180 days is well inside the API's 400-day cap.
 */
export function defaultCalendarWindow(now: Date = new Date()): { from: string; to: string } {
  const from = `${lagosTodayIso(now).slice(0, 7)}-01`;
  return { from, to: addDaysIso(from, 180) };
}

/** "Fri 12 Jun 2026". Reads the YYYY-MM-DD as a calendar date; never shifted by a device timezone. */
export function formatCalendarDate(iso: string): string {
  const d = parseIso(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Fri 12 Jun 2026" for one day; "Thu 19 Mar – Fri 20 Mar 2026" for a range (year shown once when shared). */
export function formatCalendarRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatCalendarDate(startIso);
  const s = parseIso(startIso);
  const sameYear = startIso.slice(0, 4) === endIso.slice(0, 4);
  const start = `${WEEKDAYS[s.getUTCDay()]} ${s.getUTCDate()} ${MONTHS_SHORT[s.getUTCMonth()]}${
    sameYear ? "" : ` ${s.getUTCFullYear()}`
  }`;
  return `${start} – ${formatCalendarDate(endIso)}`;
}

/** "June 2026" — the month heading an agenda list groups under. */
export function formatCalendarMonth(iso: string): string {
  const d = parseIso(iso);
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
