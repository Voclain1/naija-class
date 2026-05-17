import { ForbiddenError, UnauthorizedError } from "@school-kit/types";

import { withTenant } from "@school-kit/db";

import type { AuthContext } from "./auth-context";

// Defense-in-depth role + active-status gate, shared by every handler that
// performs a tenant-scoped mutation on behalf of an owner or admin.
//
// Re-fetches the user and their role grants under withTenant because users
// and user_roles are FORCE-RLS'd. Two gates in one helper because they
// share the fetch — separating them would re-query twice for no benefit.
//
//   - Active check: AuthGuard already rejected !is_active, but a
//     deactivation can land between requests; CLAUDE.md says "never trust
//     the JWT subject alone for mutations".
//   - Role check: handler-level authorisation. Owner-only routes pass
//     ['owner']; owner-or-admin routes pass ['owner', 'admin'].
//
// Originally lived as a private function in schools.service.ts. Lifted to
// common/auth/ when Slice 7 added a second caller (users.service.ts).
export async function assertUserActiveAndHasOneOf(
  authCtx: AuthContext,
  allowedRoleKeys: readonly string[],
): Promise<void> {
  const { isActive, roleKeys } = await withTenant(authCtx.schoolId, async (db) => {
    const user = await db.user.findUnique({
      where: { id: authCtx.userId },
      select: { isActive: true },
    });
    const grants = await db.userRole.findMany({
      where: { userId: authCtx.userId },
      select: { role: { select: { key: true } } },
    });
    return {
      isActive: user?.isActive ?? false,
      roleKeys: grants.map((g) => g.role.key),
    };
  });

  if (!isActive) {
    throw new UnauthorizedError("USER_INACTIVE", "Your account has been deactivated.");
  }
  if (!roleKeys.some((k) => allowedRoleKeys.includes(k))) {
    throw new ForbiddenError(
      `This action requires one of the following roles: ${allowedRoleKeys.join(", ")}.`,
    );
  }
}
