import { ForbiddenError } from "@school-kit/types";

import type { withTenant } from "@school-kit/db";

import { getTeacherScope } from "../teacher-scope/teacher-scope.helper.js";

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * A teacher may only touch a child they actually teach. Shared by behaviour
 * records, incidents and discipline actions, so all three keep one rule.
 *
 * Deliberately wider than "form teacher" and far narrower than "any student":
 * the teacher who saw what happened is often a subject teacher, not the form
 * tutor, and requiring the form tutor to write it second-hand is how conduct
 * records stop being written at all. But a teacher with no connection to a
 * child has no business writing about them.
 */
export async function assertTeachesStudent(
  db: Db,
  teacherId: string,
  studentId: string,
  message = "You can only record behaviour for a student you teach.",
): Promise<void> {
  const scope = await getTeacherScope(db as never, teacherId);
  const armIds = new Set(scope.classArms.map((arm) => arm.id));
  if (armIds.size === 0) {
    throw new ForbiddenError(message);
  }
  const enrolment = await db.enrollment.findFirst({
    where: { studentId, status: "ENROLLED", classArmId: { in: [...armIds] } },
    select: { id: true },
  });
  if (!enrolment) {
    throw new ForbiddenError(message);
  }
}
