import type { CbtAttemptFlag, CbtCandidateProgressDto, CbtResultRowDto, CbtSittingStatus, CbtSittingSummaryDto } from "@school-kit/types";

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

/** "Not started" · "Sitting — 12 of 40 answered" · "Submitted — 38 of 40 answered (2 computers)" */
export function cbtProgressLabel(progress: CbtCandidateProgressDto | null, questionCount: number): string {
  if (!progress) return "Not started";
  const state = progress.submitted ? "Submitted" : "Sitting";
  const machines = progress.machines > 1 ? ` (${progress.machines} computers)` : "";
  return `${state} — ${progress.answeredCount} of ${questionCount} answered${machines}`;
}

/** What a teacher reads beside an attempt. Flags never decide anything (D6). */
export function cbtFlagLabel(flag: CbtAttemptFlag, focusLosses: number): string {
  switch (flag) {
    case "LATE_START":
      return "Started after the latest start";
    case "OVER_TIME":
      return "Ran over time";
    case "NOT_SUBMITTED":
      return "Did not finish";
    case "AFTER_CLOSE":
      return "Arrived after the close";
    case "LEFT_WINDOW":
      return `Left the exam window ${focusLosses === 1 ? "once" : `${focusLosses} times`}`;
  }
}

/** Why a row has no total yet, or null when it is ready for the gradebook. */
export function cbtNotReadyReason(row: Pick<CbtResultRowDto, "attempts" | "needsChoice" | "total" | "objectiveScore">): string | null {
  if (row.total !== null) return null;
  if (row.attempts.length === 0) return "No answers received";
  if (row.needsChoice) return "Choose which computer counts";
  return "Theory mark needed";
}

/** A typed theory mark → a whole number in 0..max, null for empty, or "invalid". */
export function parseTheoryMark(typed: string, max: number): number | null | "invalid" {
  const t = typed.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return "invalid";
  const n = Number(t);
  return n <= max ? n : "invalid";
}
