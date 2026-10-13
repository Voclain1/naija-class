import type { AttendanceStatusDto } from "@school-kit/types";

// The line on a child's card for today's register (GET /portal/students
// todayAttendance). The absence alert says only "a child was marked absent
// today"; this is where a family with several children sees which one
// (pre-build audit, 2026-10-13). Nothing shows until the register is taken.
export function attendanceTodayLine(
  status: AttendanceStatusDto | null | undefined,
): { text: string; tone: "info" | "warning" } | null {
  switch (status) {
    case "ABSENT":
      return { text: "Marked absent today.", tone: "warning" };
    case "LATE":
      return { text: "Marked late today.", tone: "info" };
    case "EXCUSED":
      return { text: "Excused today.", tone: "info" };
    case "PRESENT":
      return { text: "In school today.", tone: "info" };
    default:
      return null;
  }
}
