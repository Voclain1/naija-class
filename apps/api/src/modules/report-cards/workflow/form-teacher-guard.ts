import { NotFoundError } from "@school-kit/types";

import type { AuthContext } from "../../../common/auth/auth-context.js";

type TenantDb = Parameters<Parameters<typeof import("@school-kit/db").withTenant>[1]>[0];

// Owner/admin, or the arm's OWN form teacher. Extracted from
// ReportCardWorkflowService (where it was a private method) in Phase 5 slice 4,
// so the AI form-comment generator enforces the identical rule rather than a
// second, drifting copy of it — same reasoning as released-guard.ts next door,
// and the same reason slice 3 read teacher scope from getTeacherScope instead
// of re-deriving it.
//
// Throws NotFoundError, never Forbidden, on both the missing-arm and
// wrong-teacher paths. That is deliberate and matches the rest of the teacher
// surface: a teacher probing arm ids must not be able to tell "exists but not
// yours" from "does not exist".
export async function assertOwnerAdminOrFormTeacher(
  db: TenantDb,
  authCtx: AuthContext,
  classArmId: string,
): Promise<void> {
  const arm = await db.classArm.findUnique({
    where: { id: classArmId },
    select: { id: true, classTeacherId: true },
  });
  if (!arm) throw new NotFoundError("Class arm not found.");

  const roleKeys = (
    await db.userRole.findMany({
      where: { userId: authCtx.userId },
      select: { role: { select: { key: true } } },
    })
  ).map((g) => g.role.key);

  if (roleKeys.includes("owner") || roleKeys.includes("admin")) return;
  if (roleKeys.includes("teacher") && arm.classTeacherId === authCtx.userId) return;
  throw new NotFoundError("Class arm not found.");
}
