import * as crypto from "node:crypto";
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { basePrisma } from "@school-kit/db";
import { UnauthorizedError } from "@school-kit/types";

import type { AuthContext } from "./auth-context";

// Bearer-token AuthGuard. Strictly case-sensitive `Bearer ` prefix.
//
// Why strict casing: HTTP says auth schemes are case-insensitive, but every
// production HTTP client we control sends "Bearer". Accepting `bearer` or
// `BEARER` would let lazy clients ship and create a moving target for any
// future swap to Better Auth's exact behaviour. Test coverage pins this.
//
// Why the SECURITY DEFINER function: `sessions` is under FORCE RLS and its
// policy joins through users.school_id. We cannot scope to a tenant before
// we know which tenant the token belongs to. `auth_resolve_session` is
// the single, audited escape hatch — see migration
// 20260516000000_add_auth_lookup_functions.
//
// What we DO attach to req.user: { sessionId, userId, schoolId }.
// What we DELIBERATELY DON'T: roles, permissions, email, name. Handlers
// that need permissions re-fetch via withTenant, which means a role
// revocation takes effect on the next request, not after the token expires.
const BEARER_PREFIX = "Bearer ";

interface ResolveSessionRow {
  session_id: string;
  user_id: string;
  school_id: string;
  expires_at: Date;
  user_is_active: boolean;
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthContext }>();

    const header = req.header("authorization");
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError("MISSING_BEARER_TOKEN", "Authentication required.");
    }

    const rawToken = header.slice(BEARER_PREFIX.length).trim();
    if (rawToken.length === 0) {
      throw new UnauthorizedError("MISSING_BEARER_TOKEN", "Authentication required.");
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    // SECURITY DEFINER function — bypasses RLS for this lookup ONLY.
    // Returns at most one row.
    const rows = await basePrisma.$queryRaw<ResolveSessionRow[]>`
      SELECT * FROM auth_resolve_session(${tokenHash})
    `;
    const row = rows[0];
    if (!row) {
      throw new UnauthorizedError("INVALID_SESSION", "Session is invalid or has been revoked.");
    }

    if (row.expires_at.getTime() <= Date.now()) {
      // We do NOT delete the row here — keeps the guard hot path read-only.
      // A daily sweeper (see docs/deferred.md) will clean up.
      throw new UnauthorizedError("SESSION_EXPIRED", "Session has expired. Please sign in again.");
    }

    if (!row.user_is_active) {
      throw new UnauthorizedError("USER_INACTIVE", "Your account has been deactivated.");
    }

    req.user = {
      sessionId: row.session_id,
      userId: row.user_id,
      schoolId: row.school_id,
    };
    return true;
  }
}
