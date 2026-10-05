import type { CbtAttemptFlag } from "@school-kit/types";

// Online exams (CBT3) — marking and flags (docs/modules/cbt.md D4, D6, D8).
// Pure: no database, no clock. The results service feeds it the frozen
// paper's key and each attempt as stored, and the spec pins every rule.

/** itemId → the one correct option and what the question is worth. */
export type MarkingKey = Map<string, { correctOptionId: string; marks: number }>;

/** Marks for every answer that is the item's correct option. Unknown items score nothing. */
export function objectiveScore(key: MarkingKey, answers: Record<string, string>): number {
  let total = 0;
  for (const [itemId, optionId] of Object.entries(answers)) {
    const item = key.get(itemId);
    if (item && item.correctOptionId === optionId) total += item.marks;
  }
  return total;
}

/** A machine's clock and ours never agree exactly; this much is not a flag. */
export const CLOCK_GRACE_MS = 2 * 60_000;

export interface AttemptTimes {
  startedAt: Date;
  submittedAt: Date | null;
  lastReceivedAt: Date;
  extraMinutes: number;
  focusLosses: number;
}

export interface SittingTimes {
  windowEndsAt: Date;
  durationMinutes: number;
  closedAt: Date | null;
}

/** Start to finish, or to the last answers received if the attempt never finished. */
export function minutesTaken(a: AttemptTimes): number {
  const end = a.submittedAt ?? a.lastReceivedAt;
  return Math.max(0, Math.round((end.getTime() - a.startedAt.getTime()) / 60_000));
}

export function attemptFlags(a: AttemptTimes, s: SittingTimes): CbtAttemptFlag[] {
  const flags: CbtAttemptFlag[] = [];
  if (a.startedAt.getTime() > s.windowEndsAt.getTime() + CLOCK_GRACE_MS) flags.push("LATE_START");
  if (a.submittedAt) {
    const allowedMs = (s.durationMinutes + a.extraMinutes) * 60_000 + CLOCK_GRACE_MS;
    if (a.submittedAt.getTime() - a.startedAt.getTime() > allowedMs) flags.push("OVER_TIME");
  } else {
    flags.push("NOT_SUBMITTED");
  }
  if (s.closedAt && a.lastReceivedAt.getTime() > s.closedAt.getTime()) flags.push("AFTER_CLOSE");
  if (a.focusLosses > 0) flags.push("LEFT_WINDOW");
  return flags;
}

/**
 * Which attempt counts (D5): the one the teacher chose, else the only one.
 * Two or more with none chosen needs the teacher.
 */
export function countingAttempt<A extends { id: string; chosen: boolean }>(attempts: A[]): { attempt: A | null; needsChoice: boolean } {
  const chosen = attempts.find((a) => a.chosen);
  if (chosen) return { attempt: chosen, needsChoice: false };
  if (attempts.length === 1) return { attempt: attempts[0]!, needsChoice: false };
  return { attempt: null, needsChoice: attempts.length > 1 };
}

/**
 * The mark that goes to the gradebook, out of the paper's total — or null
 * while it is not ready: no attempt counts yet, or the paper has questions
 * sat on paper and their mark has not been typed in.
 */
export function resultTotal(objective: number | null, theoryMark: number | null, onPaperTotal: number): number | null {
  if (objective === null) return null;
  if (onPaperTotal > 0 && theoryMark === null) return null;
  return objective + (theoryMark ?? 0);
}
