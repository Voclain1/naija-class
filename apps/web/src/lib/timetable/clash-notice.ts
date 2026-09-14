import { toast } from "sonner";

import { describeTimetableClash, type TimetableClashDto } from "@school-kit/types";

// Phase 8 / CP4 (docs/modules/phase-8.md §18 D43). Creating a term or
// re-activating a class can bring a timetable clash into force. The change is
// allowed; this makes sure the admin is TOLD, in words, with a way to fix it —
// a warning that stays until dismissed, never a silent success.

export function clashNoticeText(clashes: TimetableClashDto[], cause: string): { title: string; lines: string[] } {
  const n = clashes.length;
  return {
    title: `${cause} put ${n} timetable clash${n === 1 ? "" : "es"} into force`,
    lines: clashes.slice(0, 4).map(describeTimetableClash).concat(n > 4 ? [`…and ${n - 4} more`] : []),
  };
}

export function announceTimetableClashes(clashes: TimetableClashDto[] | undefined, cause: string, openTimetable: () => void): void {
  if (!clashes || clashes.length === 0) return;
  const { title, lines } = clashNoticeText(clashes, cause);
  toast.warning(title, {
    description: lines.join(" · "),
    duration: Infinity,
    action: { label: "Fix on Timetable", onClick: openTimetable },
  });
}
