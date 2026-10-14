import type { HomeworkDto } from "@school-kit/types";

// The counter lookup (/staff/homework/lookup; the web's twin is /homework): a
// bursar answering "what homework does my child have?" for one class. Withdrawn work is left out —
// the class no longer sees it, so neither should the person answering. What is
// still to come reads first, soonest first; what was due recently follows,
// latest first, because a parent asking about yesterday's work is common.

export const RECENT_DAYS = 7;

export interface HomeworkLookup {
  upcoming: HomeworkDto[];
  recent: HomeworkDto[];
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function splitHomeworkForLookup(items: HomeworkDto[], todayIso: string): HomeworkLookup {
  const live = items.filter((item) => !item.withdrawnAt);
  const since = addDays(todayIso, -RECENT_DAYS);
  return {
    upcoming: live
      .filter((item) => item.dueDate >= todayIso)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    recent: live
      .filter((item) => item.dueDate < todayIso && item.dueDate >= since)
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
  };
}
