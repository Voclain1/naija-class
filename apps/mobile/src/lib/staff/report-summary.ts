import type {
  AttendanceArmRowDto,
  ScoreEntryRowDto,
  TeacherActivityRowDto,
} from "@school-kit/types";

// Reading the completeness report on a phone.
//
// On the website these are long tables. On a phone the only useful question is
// "what is BEHIND", so these helpers turn a table into a short list, worst
// first, and leave out everything that is fine. Pure, so the ordering and the
// arithmetic are tested without a device.
//
// Every figure comes from the server; nothing here recounts. The one thing
// computed is a percentage for display, and it is null — not zero — when there
// is nothing to measure against, because "0% of 0 registers" reads as a failure
// when it is actually "no school days yet".

/** Whole-number percentage, or null when there is nothing expected yet. */
export function percent(done: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.min(100, Math.round((done / expected) * 100));
}

/** Classes whose registers are behind, worst first. Complete classes are omitted. */
export function laggingRegisters(rows: readonly AttendanceArmRowDto[]): AttendanceArmRowDto[] {
  return rows
    .filter((row) => row.registersExpected > 0 && row.registersTaken < row.registersExpected)
    .sort(
      (a, b) =>
        a.registersTaken / a.registersExpected - b.registersTaken / b.registersExpected ||
        a.label.localeCompare(b.label),
    );
}

/** Subject-in-class pairs whose marks are behind, worst first. */
export function laggingScores(rows: readonly ScoreEntryRowDto[]): ScoreEntryRowDto[] {
  return rows
    .filter((row) => row.slotsExpected > 0 && row.slotsEntered < row.slotsExpected)
    .sort(
      (a, b) =>
        a.slotsEntered / a.slotsExpected - b.slotsEntered / b.slotsExpected ||
        a.label.localeCompare(b.label) ||
        a.subjectName.localeCompare(b.subjectName),
    );
}

/**
 * Teachers, the ones with the most still outstanding first.
 *
 * Ordered by their assigned marks outstanding, then by their form class's
 * registers — a head reads down this list to decide whom to ring.
 */
export function teachersByOutstanding(rows: readonly TeacherActivityRowDto[]): TeacherActivityRowDto[] {
  const marksLeft = (row: TeacherActivityRowDto) => row.assignedSlotsExpected - row.assignedSlotsEntered;
  const registersLeft = (row: TeacherActivityRowDto) =>
    row.formArmRegistersExpected - row.formArmRegistersTaken;
  return [...rows].sort(
    (a, b) =>
      marksLeft(b) - marksLeft(a) || registersLeft(b) - registersLeft(a) || a.name.localeCompare(b.name),
  );
}
