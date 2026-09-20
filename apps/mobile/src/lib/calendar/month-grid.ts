// Month-grid maths for the calendar screen.
//
// Pure and separately tested because a date grid is easy to get subtly wrong
// in ways nobody notices until a teacher says "my staff meeting is on the
// wrong day": a month starting on Sunday, a leap February, a multi-day event
// that should appear on every day it covers rather than only its first.
//
// Everything here works on ISO yyyy-mm-dd strings in UTC. No Date object ever
// reaches a timezone-sensitive method, which is the same rule the @db.Date
// convention follows on the server: the string IS the calendar date.

export interface MonthCell {
  /** ISO date, always present — cells outside the month are still real dates. */
  date: string;
  dayOfMonth: number;
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
}

const MONTH_NAMES = [
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

/** Monday-first, matching a Nigerian school week. */
export const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

function utc(date: string): number {
  return Date.parse(date + "T00:00:00.000Z");
}

export function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "2026-09" → "September 2026". */
export function formatMonth(month: string): string {
  const [year, monthNumber] = month.split("-");
  const index = Number(monthNumber) - 1;
  return `${MONTH_NAMES[index] ?? month} ${year}`;
}

/** "2026-09" → "2026-08"; handles the year boundary. */
export function shiftMonth(month: string, months: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const zeroBased = (year ?? 0) * 12 + (monthNumber ?? 1) - 1 + months;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (zeroBased % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** First and last date of a month, inclusive — the window to fetch. */
export function monthBounds(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const to = addDays(`${shiftMonth(month, 1)}-01`, -1);
  return { from, to };
}

/**
 * The grid a month renders as: whole weeks, Monday first, padded with the
 * neighbouring months' days so every row has seven cells.
 */
export function buildMonthGrid(month: string): MonthCell[] {
  const { from, to } = monthBounds(month);
  // getUTCDay is 0 = Sunday; shift so Monday is 0.
  const leading = (new Date(utc(from)).getUTCDay() + 6) % 7;
  const start = addDays(from, -leading);
  const cells: MonthCell[] = [];
  // Always whole weeks, and always enough rows to contain the month.
  for (let index = 0; ; index += 1) {
    const date = addDays(start, index);
    cells.push({
      date,
      dayOfMonth: Number(date.slice(8, 10)),
      inMonth: date >= from && date <= to,
    });
    if (index % 7 === 6 && date >= to) break;
  }
  return cells;
}

/** Does an entry's inclusive start..end range cover this date? */
export function entryCoversDate(
  entry: { startDate: string; endDate: string },
  date: string,
): boolean {
  return entry.startDate <= date && date <= entry.endDate;
}

/**
 * Every entry touching a given date, in the order the API gave them.
 *
 * A multi-day entry (a break, an exam period) belongs on EVERY day it covers:
 * a teacher tapping the Wednesday of an exam week must see the exams, not an
 * empty day because the period began on Monday.
 */
export function entriesOnDate<T extends { startDate: string; endDate: string }>(
  entries: readonly T[],
  date: string,
): T[] {
  return entries.filter((entry) => entryCoversDate(entry, date));
}
