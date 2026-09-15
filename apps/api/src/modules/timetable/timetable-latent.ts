import type { TimetableClashDto } from "@school-kit/types";

import { addedClashes, findTimetableClashes, lockSchoolTimetables, type TenantDb } from "./timetable-clash.js";

// Phase 8 / CP4 — clashes that come into force WITHOUT a timetable edit
// (docs/modules/phase-8.md §18 D43).
//
// Enumerated from the code, the only two paths are:
//   * TermsService.create — the year's whole-year timetables come into force for
//     the new term;
//   * ClassArmsService.update re-activating a class — its timetables are counted
//     again (D44).
// Both call clashesAddedBy() around their write. The change is ALLOWED (refusing
// a term would force the wrong fix — the natural fix, a term timetable, cannot
// exist before the term does); the clashes it added are returned to the caller,
// which puts them in its response and audit row. Surfaced, never silent. The
// timetable builder's banner lists them afterwards from the same query.
//
// Takes the timetable lock, so the before/after comparison cannot interleave
// with a concurrent timetable edit.

export async function clashesAddedBy<T>(
  db: TenantDb,
  schoolId: string,
  academicYearIds: string[],
  change: () => Promise<T>,
): Promise<{ value: T; added: TimetableClashDto[] }> {
  const years = [...new Set(academicYearIds)];
  if (years.length === 0) return { value: await change(), added: [] };

  await lockSchoolTimetables(db, schoolId);
  const before = new Map<string, TimetableClashDto[]>();
  for (const y of years) before.set(y, await findTimetableClashes(db, schoolId, y));

  const value = await change();

  const added: TimetableClashDto[] = [];
  for (const y of years) added.push(...addedClashes(before.get(y)!, await findTimetableClashes(db, schoolId, y)));
  return { value, added };
}
