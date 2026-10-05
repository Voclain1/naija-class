import type { CbtSittingStatus, CbtSittingSummaryDto } from "@school-kit/types";

// Pure display helpers for online exams (docs/modules/cbt.md). Unit-tested.

export function cbtStatusLabel(status: CbtSittingStatus): string {
  return status === "DRAFT" ? "Draft" : status === "PUBLISHED" ? "Published" : "Closed";
}

/** A date ("2026-11-20") and a wall-clock time ("09:00") in this browser's zone → a moment. */
export function localMoment(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const timeOf = (d: Date) => d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

/** "Fri 20 Nov 2026, 09:00 (start by 09:30) · 40 min" */
export function describeSittingTime(s: Pick<CbtSittingSummaryDto, "startsAt" | "windowEndsAt" | "durationMinutes">): string {
  const start = new Date(s.startsAt);
  const latest = new Date(s.windowEndsAt);
  const day = start.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const sameDay = start.toDateString() === latest.toDateString();
  const by = sameDay ? timeOf(latest) : `${latest.toLocaleDateString("en-NG", { day: "numeric", month: "short" })} ${timeOf(latest)}`;
  return `${day}, ${timeOf(start)} (start by ${by}) · ${s.durationMinutes} min`;
}
