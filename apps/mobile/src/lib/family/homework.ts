import type { HomeworkFeedItemDto } from "@school-kit/types";

// Ordering homework for a family (docs/modules/the-school-day.md Part B).
//
// Its own react-native-free module, like push-eligibility and family/today:
// apps/mobile's Vitest runs node-env with no React Native transform, so a
// helper living inside a .tsx component is unreachable from a spec. The
// rendering is in components/homework-list.tsx.
//
// Grouped by WHEN, not by subject. A child at a kitchen table is answering
// "what must I do tonight?", and a subject-first list makes them read all of
// it to find out. Overdue first, because that is the part someone needs to
// know about; then today, tomorrow, and the rest by date.

export interface HomeworkGroup {
  label: string;
  overdue: boolean;
  items: HomeworkFeedItemDto[];
}

function dayLabel(dueDate: string, today: string, tomorrow: string): string {
  if (dueDate < today) return "Overdue";
  if (dueDate === today) return "Due today";
  if (dueDate === tomorrow) return "Due tomorrow";
  return new Date(`${dueDate}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

export function groupHomework(
  items: readonly HomeworkFeedItemDto[],
  today: string,
  tomorrow: string,
): HomeworkGroup[] {
  const order = [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const groups: HomeworkGroup[] = [];
  for (const item of order) {
    const label = dayLabel(item.dueDate, today, tomorrow);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, overdue: item.overdue, items: [item] });
  }
  // Overdue is ONE group however many days it spans: a child does not need
  // "overdue since Tuesday" and "overdue since Thursday" as separate headings.
  return groups.sort((a, b) => Number(b.overdue) - Number(a.overdue));
}
