import type { TeacherAssignmentDto } from "@school-kit/types";

import { listTeacherAssignments } from "../staff/staff-api";

// Every teacher assignment in one academic year, following the list endpoint's
// cursor to the end. The owner/admin gradebook uses them only to mark which
// subjects already have a teacher; it never narrows what can be graded.
export async function listYearTeacherAssignments(academicYearId: string): Promise<TeacherAssignmentDto[]> {
  const all: TeacherAssignmentDto[] = [];
  let cursor: string | undefined;
  do {
    const page = await listTeacherAssignments({ academicYearId, limit: 500, cursor });
    all.push(...page.data);
    cursor = page.meta.cursor;
  } while (cursor);
  return all;
}
