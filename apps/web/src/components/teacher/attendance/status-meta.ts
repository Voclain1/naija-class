import type { AttendanceStatusDto } from "@school-kit/types";

// The four daily-attendance states, in toggle order, with a one-letter chip
// label, a full word for a11y/tooltips, and the colours for the active button.
// Present/Late count as "attended" (green/amber); Absent/Excused as not (red/
// violet) — the same green→amber→red→violet ramp the report-card badges use.
export const STATUS_META: Record<
  AttendanceStatusDto,
  { letter: string; full: string; active: string; dot: string }
> = {
  PRESENT: { letter: "P", full: "Present", active: "border-emerald-600 bg-emerald-600 text-white", dot: "bg-emerald-500" },
  ABSENT: { letter: "A", full: "Absent", active: "border-red-600 bg-red-600 text-white", dot: "bg-red-500" },
  LATE: { letter: "L", full: "Late", active: "border-amber-500 bg-amber-500 text-white", dot: "bg-amber-500" },
  EXCUSED: { letter: "E", full: "Excused", active: "border-violet-600 bg-violet-600 text-white", dot: "bg-violet-500" },
};

export const STATUS_ORDER: AttendanceStatusDto[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
