import { withTenant, type PrismaClient } from "@school-kit/db";
import { ForbiddenError } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { getActiveUserRoleKeys } from "../../common/auth/role-check.js";

// Shared by the Store and the asset register (docs/modules/id-cards-and-store.md §4).

export interface RequestContext {
  ipAddress: string | null;
}

/** The permissions the signed-in person holds ("*" for the owner), after the active-account check. */
export async function heldPermissions(authCtx: AuthContext): Promise<Set<string>> {
  await getActiveUserRoleKeys(authCtx);
  return withTenant(authCtx.schoolId, async (db) => {
    const grants = await db.userRole.findMany({
      where: { userId: authCtx.userId },
      select: { role: { select: { permissions: true } } },
    });
    const out = new Set<string>();
    for (const g of grants) {
      for (const p of Array.isArray(g.role.permissions) ? g.role.permissions : []) {
        if (typeof p === "string") out.add(p);
      }
    }
    return out;
  });
}

export function holds(perms: Set<string>, permission: string): boolean {
  return perms.has("*") || perms.has(permission);
}

/** The second gate behind the controller's PermissionsGuard: any one of `anyOf`. */
export async function assertAnyOf(authCtx: AuthContext, ...anyOf: string[]): Promise<Set<string>> {
  const perms = await heldPermissions(authCtx);
  if (!anyOf.some((p) => holds(perms, p))) {
    throw new ForbiddenError("You do not have permission to do that.");
  }
  return perms;
}

/** First and last names of staff, for "recorded by" lines. */
export async function staffNames(db: PrismaClient, ids: Iterable<string>): Promise<Map<string, string>> {
  const list = [...new Set(ids)];
  if (list.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: list } },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
}

export function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
