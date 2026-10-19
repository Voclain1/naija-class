// Phase 9 / CP11.2 (docs/modules/phase-9.md §20) — Lagos calendar days for
// the day-at-a-time lists (the sickbay day list) and day groups (incidents).

/** The calendar day `delta` days from `isoDay` (YYYY-MM-DD), no time zone involved. */
export function shiftDay(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Items grouped by their day, newest day first, keeping each day's order. */
export function groupByDay<T>(items: readonly T[], dayOf: (item: T) => string): { day: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const day = dayOf(item);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)).map(([day, list]) => ({ day, items: list }));
}
