// Phase 9 / CP6.2 — the library fine (docs/modules/phase-9.md §14 CP6-D3).
//
// Pure functions over Lagos calendar dates (YYYY-MM-DD), so they are tested on
// their own and used in one place for both the overdue list's estimate and the
// fine raised at return.
//
// LATE DAYS are calendar days after the due date, up to and including the
// return date, that fall inside a term. The holiday between terms is not
// fined. Mid-term breaks are, because the calendar does not mark closures.

export interface TermSpan {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  /** The school's current term wins where terms overlap. */
  isCurrent?: boolean;
}

export interface FineRule {
  finePerDay: number; // kobo
  fineGraceDays: number;
  fineCap: number | null; // kobo
}

const DAY_MS = 86_400_000;
const time = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);

/**
 * Days in (dueOn, returnOn] that fall inside a term. Each day counts once,
 * even where two terms overlap (terms of different years are not checked
 * against each other, so a school can have overlapping ones).
 */
export function termLateDays(dueOn: string, returnOn: string, terms: TermSpan[]): number {
  const from = time(dueOn) + DAY_MS; // the day after the due date
  const to = time(returnOn);
  if (to < from) return 0;
  const spans = terms
    .map((t) => [Math.max(from, time(t.startDate)), Math.min(to, time(t.endDate))] as const)
    .filter(([start, end]) => end >= start)
    .sort((a, b) => a[0] - b[0]);
  let days = 0;
  let countedTo = -Infinity; // the last day already counted
  for (const [start, end] of spans) {
    const first = Math.max(start, countedTo + DAY_MS);
    if (end >= first) {
      days += Math.round((end - first) / DAY_MS) + 1;
      countedTo = end;
    }
  }
  return days;
}

/** rate × (late days − grace), never below 0, never above the cap. Kobo. */
export function fineFor(dueOn: string, returnOn: string, terms: TermSpan[], rule: FineRule): number {
  const chargeable = Math.max(0, termLateDays(dueOn, returnOn, terms) - rule.fineGraceDays);
  const fine = chargeable * rule.finePerDay;
  return rule.fineCap === null ? fine : Math.min(fine, rule.fineCap);
}

/**
 * The term a library charge raised on `date` belongs to: the term the date
 * falls in (the current term, where two overlap); in a holiday, the next term
 * to start (whose invoice is the next the family receives); with no later term
 * set up, the last one to end.
 */
export function chargeTermFor(date: string, terms: TermSpan[]): string | null {
  const t = time(date);
  const inside = terms.filter((x) => time(x.startDate) <= t && t <= time(x.endDate));
  const chosen = inside.find((x) => x.isCurrent) ?? inside[0];
  if (chosen) return chosen.id;
  const next = [...terms].filter((x) => time(x.startDate) > t).sort((a, b) => time(a.startDate) - time(b.startDate))[0];
  if (next) return next.id;
  const last = [...terms].sort((a, b) => time(b.endDate) - time(a.endDate))[0];
  return last?.id ?? null;
}
