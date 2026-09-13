import type { CalendarEntryDto, ExcludedDayDto, SchoolDaysDto } from "@school-kit/types";

// Phase 8 / CP2 — what "a register expected" means (docs/modules/phase-8.md §16 D33–D34).
//
// PURE. No database, no clock: `today` is passed in. Everything the completeness
// report claims about attendance rests on this function, so it is isolated to be
// tested exhaustively on its own AND exercised through the real-database spec.
//
// A school day is a Monday–Friday in [term start, min(today, term end)] that is
// not excluded. A day is excluded (Q31, approved 2026-09-13) when the calendar —
// read through CP1's single builder, which has already removed national events
// this school hid — shows on it:
//   * a NATIONAL event whose date is CONFIRMED. An unconfirmed estimate (a
//     2027 Eid before the Ministry declares it) is NOT excluded: the report must
//     not forgive a missed register on a day that may not be the holiday;
//   * a SCHOOL event in category HOLIDAY or BREAK.
// Nothing else removes a day: term markers, meetings, exam periods and
// resumption days are ordinary school days.
//
// This only changes which days a register was EXPECTED. Attendance records and
// rates are untouched — §3.3 D20 stands for them.

const DAY_MS = 86_400_000;

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every YYYY-MM-DD from `from` to `to` inclusive (empty when to < from). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = toDate(from).getTime(); t <= toDate(to).getTime(); t += DAY_MS) out.push(toIso(new Date(t)));
  return out;
}

export function isWeekend(iso: string): boolean {
  const dow = toDate(iso).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Why an entry removes its days, or null when it does not. */
function exclusionReason(e: CalendarEntryDto): string | null {
  if (e.source === "NATIONAL") return e.dateConfirmed ? `${e.title} (public holiday)` : null;
  if (e.source === "SCHOOL" && e.category === "HOLIDAY") return `${e.title} (school holiday)`;
  if (e.source === "SCHOOL" && e.category === "BREAK") return `${e.title} (school break)`;
  return null;
}

export interface SchoolDaysResult {
  dto: SchoolDaysDto;
  /** The school days themselves, for intersecting with marked registers. */
  schoolDaySet: Set<string>;
}

/**
 * @param termStart YYYY-MM-DD
 * @param termEnd   YYYY-MM-DD
 * @param today     YYYY-MM-DD (Lagos) — the report's "as of" day
 * @param calendar  entries from CalendarService.buildCalendar for [termStart, countedTo]
 */
export function computeSchoolDays(
  termStart: string,
  termEnd: string,
  today: string,
  calendar: CalendarEntryDto[],
): SchoolDaysResult {
  const countedTo = today < termEnd ? today : termEnd;
  if (countedTo < termStart) {
    // Term has not started: nothing is expected yet.
    return {
      dto: { asOf: today, countedFrom: null, countedTo: null, schoolDayCount: 0, excludedDays: [] },
      schoolDaySet: new Set(),
    };
  }

  // date → reasons (a day can carry two, e.g. a public holiday inside a school break).
  const reasons = new Map<string, string[]>();
  for (const e of calendar) {
    const why = exclusionReason(e);
    if (!why) continue;
    const from = e.startDate > termStart ? e.startDate : termStart;
    const to = e.endDate < countedTo ? e.endDate : countedTo;
    for (const d of eachDay(from, to)) {
      const list = reasons.get(d) ?? [];
      if (!list.includes(why)) list.push(why);
      reasons.set(d, list);
    }
  }

  const schoolDaySet = new Set<string>();
  const excludedDays: ExcludedDayDto[] = [];
  for (const d of eachDay(termStart, countedTo)) {
    if (isWeekend(d)) continue; // weekends are not school days, and are not "excluded" either
    const why = reasons.get(d);
    if (why) excludedDays.push({ date: d, reason: why.join("; ") });
    else schoolDaySet.add(d);
  }

  return {
    dto: {
      asOf: today,
      countedFrom: termStart,
      countedTo,
      schoolDayCount: schoolDaySet.size,
      excludedDays,
    },
    schoolDaySet,
  };
}
