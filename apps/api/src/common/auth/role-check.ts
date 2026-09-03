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
/**
 * Same active + role fetch as `assertUserActiveAndHasOneOf`, but RETURNS the
 * role keys instead of only throwing.
 *
 * Exists for authorisation that is not a flat role test — specifically
 * ownership-scoped rules, where "may this user act?" depends on both their role
 * AND the row in front of them (a teacher may delete a curriculum document they
 * uploaded; an admin may delete any). Expressing that with the throwing helper
 * would mean catching a ForbiddenError to use it as a boolean, which reads as
 * an error path and hides the actual rule.
 *
 * Still asserts active status, for the same reason the sibling does: a
 * deactivation can land between requests.
 */
export async function getActiveUserRoleKeys(authCtx: AuthContext): Promise<string[]> {
  const { isActive, roleKeys } = await fetchActiveAndRoles(authCtx);
  if (!isActive) {
    throw new UnauthorizedError("USER_INACTIVE", "Your account has been deactivated.");
  }
  return roleKeys;
}

async function fetchActiveAndRoles(
  authCtx: AuthContext,
): Promise<{ isActive: boolean; roleKeys: string[] }> {
  return withTenant(authCtx.schoolId, async (db) => {
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
}

export async function assertUserActiveAndHasOneOf(
  authCtx: AuthContext,
  allowedRoleKeys: readonly string[],
): Promise<void> {
  const { isActive, roleKeys } = await fetchActiveAndRoles(authCtx);

  if (!isActive) {
    throw new UnauthorizedError("USER_INACTIVE", "Your account has been deactivated.");
  }
  if (!roleKeys.some((k) => allowedRoleKeys.includes(k))) {
    throw new ForbiddenError(
      `This action requires one of the following roles: ${allowedRoleKeys.join(", ")}.`,
    );
  }
}
