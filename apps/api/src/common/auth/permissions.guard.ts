import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { withTenant } from "@school-kit/db";
import { ForbiddenError, PERMISSION_WILDCARD, UnauthorizedError } from "@school-kit/types";

import type { AuthContext } from "./auth-context";
import { PERMISSIONS_METADATA_KEY } from "./permissions.decorator";

// Permission-string authorization gate. Slice 13's RBAC rollup.
//
// Runs AFTER AuthGuard (which populates req.user). Wire as
// `@UseGuards(AuthGuard, PermissionsGuard)` — order matters: this guard reads
// req.user.{userId,schoolId} that AuthGuard sets.
//
// Why re-fetch permissions every request: AuthContext deliberately carries no
// roles/permissions (see auth.guard.ts header) so a role/permission revocation
// takes effect on the very next request. roles / user_roles are FORCE-RLS'd,
// so the lookup runs under withTenant. Same per-request re-fetch discipline as
// common/auth/role-check.ts; the service-layer asserts there stay as
// defense-in-depth (two independent gates).
//
// FAILS CLOSED: a handler this guard protects with no @Permissions metadata is
// rejected, not waved through. Public Phase-0 routes are unaffected — they
// don't attach this guard.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_METADATA_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (!required || required.length === 0) {
      // Fail closed: a guarded handler must declare what it needs.
      throw new ForbiddenError(
        "This endpoint is missing its permission declaration. This is a server misconfiguration.",
      );
    }

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthContext }>();
    const authCtx = req.user;
    if (!authCtx) {
      // PermissionsGuard ran without AuthGuard ahead of it.
      throw new UnauthorizedError("AUTH_REQUIRED", "Authentication required.");
    }

    const { isActive, permissions } = await withTenant(authCtx.schoolId, async (db) => {
      const user = await db.user.findUnique({
        where: { id: authCtx.userId },
        select: { isActive: true },
      });
      const grants = await db.userRole.findMany({
        where: { userId: authCtx.userId },
        select: { role: { select: { permissions: true } } },
      });
      const flat = new Set<string>();
      for (const g of grants) {
        for (const p of coercePermissions(g.role.permissions)) flat.add(p);
      }
      return { isActive: user?.isActive ?? false, permissions: flat };
    });

    if (!isActive) {
      throw new UnauthorizedError("USER_INACTIVE", "Your account has been deactivated.");
    }

    // `*` short-circuits — the owner role grants everything.
    if (permissions.has(PERMISSION_WILDCARD)) {
      return true;
    }

    const missing = required.filter((p) => !permissions.has(p));
    if (missing.length > 0) {
      throw new ForbiddenError(
        `This action requires the following permission(s): ${missing.join(", ")}.`,
      );
    }

    return true;
  }
}

// roles.permissions is a JSONB column typed as Prisma.JsonValue. In practice it
// is always a string[] (or ["*"]); coerce defensively and drop non-strings.
function coercePermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
