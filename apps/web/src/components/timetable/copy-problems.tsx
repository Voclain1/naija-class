import { ISO_WEEKDAY_LABELS, describeTimetableClash, type CopyProblemsDto } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";

// Phase 8 / CP4 — every reason a fork or copy cannot be made, in words
// (docs/modules/phase-8.md §18 D41/D42: all problems at once, never only the first).

export function problemsOf(e: unknown): CopyProblemsDto | null {
  if (!(e instanceof ApiError) || e.code !== "TIMETABLE_COPY_REFUSED") return null;
  return e.details as CopyProblemsDto;
}

export function hasProblems(p: CopyProblemsDto): boolean {
  return p.destinationLessonCount > 0 || p.unassignedTeachers.length > 0 || p.clashes.length > 0 || p.acknowledgementMismatch;
}

export function CopyProblemsList({ problems }: { problems: CopyProblemsDto }) {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {problems.destinationLessonCount > 0 && (
        <li>
          The destination already has {problems.destinationLessonCount} lesson{problems.destinationLessonCount === 1 ? "" : "s"}. Nothing is
          ever merged or overwritten — clear or delete that timetable first.
        </li>
      )}
      {problems.acknowledgementMismatch && <li>The teachers to leave off have changed since you checked. Check again.</li>}
      {problems.unassignedTeachers.map((u) => (
        <li key={`${u.dayOfWeek}-${u.bellSlotId}-${u.teacherId}`}>
          {u.teacherName} is not assigned to teach {u.subjectName} here — {ISO_WEEKDAY_LABELS[u.dayOfWeek]} {u.slotLabel}.
        </li>
      ))}
      {problems.clashes.map((c) => (
        <li key={`${c.teacherId}-${c.dayOfWeek}-${c.bellSlotId}-${c.termId}`}>Clash: {describeTimetableClash(c)}.</li>
      ))}
      {!problems.clashesChecked && <li>Clashes with other classes are checked once the destination is empty.</li>}
    </ul>
  );
}
