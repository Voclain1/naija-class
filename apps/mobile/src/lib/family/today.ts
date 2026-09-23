import type {
  FamilyTimetableDto,
  PortalInvoiceDto,
  ReleasedResultSummaryDto,
  StudentAttendanceTermDto,
} from "@school-kit/types";
import { formatKobo, formatMinuteOfDay } from "@school-kit/types";

import { totalOwed } from "./fees";

// What a family's home screen says (docs/modules/phone-for-every-role.md
// D4, D6).
//
// Pure, because a home screen's whole job is judgement — which single line is
// worth a parent's attention this morning — and that judgement should be
// testable without rendering anything.
//
// Two rules run through all of it:
//
//  - EVERY FIGURE IS THE SERVER'S. Percentages arrive as integer hundredths
//    (8750 = 87.50%) and are only formatted here; money is formatted by
//    formatKobo. Nothing is recomputed from parts.
//  - SILENCE WHEN THERE IS NOTHING TO SAY. A home that always shows a banner
//    teaches people to ignore banners, so each of these returns null unless
//    it has something real.

export interface Lesson {
  subjectName: string;
  startMinute: number;
  endMinute: number;
  label: string;
}

/**
 * The next lesson today, from the class's published timetable — the one
 * question a student opens the app to answer between periods.
 *
 * `nowMinutes` is minutes since midnight in the school's wall-clock time, the
 * same unit the timetable stores (CLAUDE.md's time-of-day convention), so no
 * timezone arithmetic happens here at all.
 */
export function nextLesson(
  timetable: FamilyTimetableDto | undefined,
  isoWeekday: number | null,
  nowMinutes: number,
): Lesson | null {
  const grid = timetable?.grid;
  if (!grid || isoWeekday === null) return null;
  const slotByPosition = new Map(grid.slots.map((slot) => [slot.position, slot]));
  const todays = grid.lessons
    .filter((lesson) => lesson.dayOfWeek === isoWeekday)
    .map((lesson) => {
      const slot = slotByPosition.get(lesson.slotPosition);
      return slot ? { subjectName: lesson.subjectName, startMinute: slot.startMinute, endMinute: slot.endMinute, label: slot.label } : null;
    })
    .filter((lesson): lesson is Lesson => lesson !== null)
    .sort((a, b) => a.startMinute - b.startMinute);
  // The lesson running now counts as "next": a student mid-period wants to
  // know what they are in, not what follows it.
  return todays.find((lesson) => lesson.endMinute > nowMinutes) ?? null;
}

export function describeLesson(lesson: Lesson): string {
  return `${lesson.subjectName} · ${formatMinuteOfDay(lesson.startMinute)}`;
}

/** "87.5%" from the server's integer hundredths, without inventing precision. */
export function formatHundredths(value: number | null | undefined): string | null {
  if (typeof value !== "number") return null;
  const whole = Math.round(value / 100);
  const oneDecimal = Math.round(value / 10) / 10;
  return Number.isInteger(oneDecimal) ? `${whole}%` : `${oneDecimal}%`;
}

/** The term a family cares about: the latest one the school has marked. */
export function latestAttendance(terms: readonly StudentAttendanceTermDto[]): StudentAttendanceTermDto | null {
  const marked = terms.filter((term) => term.daysMarked > 0);
  return [...marked].sort((a, b) => b.sequence - a.sequence)[0] ?? null;
}

export function latestResult(results: readonly ReleasedResultSummaryDto[]): ReleasedResultSummaryDto | null {
  return [...results].sort((a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime())[0] ?? null;
}

export interface Highlight {
  /** "fees" outranks "results": one is a debt with a deadline, the other is news. */
  kind: "fees" | "results";
  text: string;
  tone: "warning" | "info";
}

/**
 * The one line worth showing about a child, or nothing.
 *
 * Fees first when money is owed, because that is the thing with a
 * consequence; otherwise a freshly released result, which is what a parent
 * actually opens the app hoping to find.
 */
export function childHighlight(args: {
  invoices?: readonly PortalInvoiceDto[];
  results?: readonly ReleasedResultSummaryDto[];
}): Highlight | null {
  const owed = totalOwed(args.invoices ?? []);
  if (owed > 0) return { kind: "fees", text: `${formatKobo(owed)} outstanding`, tone: "warning" };
  const result = latestResult(args.results ?? []);
  if (result) return { kind: "results", text: `${result.termName} results are ready`, tone: "info" };
  return null;
}

/** Initials for a child's avatar, from the name the school holds. */
export function initials(first: string | null | undefined, last: string | null | undefined): string {
  const letters = [first, last]
    .map((part) => (part ?? "").trim()[0] ?? "")
    .filter(Boolean)
    .join("");
  return letters.toUpperCase() || "?";
}
