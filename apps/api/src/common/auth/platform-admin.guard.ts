import * as crypto from "node:crypto";
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { basePrisma } from "@school-kit/db";
import { ForbiddenError, UnauthorizedError } from "@school-kit/types";

import type { PlatformAdminContext } from "./platform-admin-context";

// Bearer-token guard for the internal platform super-admin surface. Mirrors
// AuthGuard (auth.guard.ts) / GuardianAuthGuard (guardian-auth.guard.ts)
// exactly in shape; see those files' headers for the full "why SECURITY
// DEFINER" / "why strict Bearer casing" rationale, which applies
// identically here.
//
// Unlike either of those guards, a resolved session here is NOT sufficient
// on its own — platform_admin_resolve_session deliberately looks up the
// SAME `sessions` table every staff session lives in (see that function's
// migration header for why: "no new credential system"), so an ordinary
// owner/admin/teacher/bursar bearer token resolves to a real row. The
// is_platform_admin column, re-read from `users` on every request, is the
// actual authorization boundary: a valid-but-non-admin session is a real
// 403 (recognized, forbidden), not a 401 (unrecognized).
//
// What we DO attach to req.platformAdmin: { sessionId, userId }. What we
// DELIBERATELY DON'T: schoolId (cross-tenant identity — see
// PlatformAdminContext), email, name.
const BEARER_PREFIX = "Bearer ";

interface ResolvePlatformAdminSessionRow {
  session_id: string;
  user_id: string;
  is_platform_admin: boolean;
  expires_at: Date;
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { platformAdmin?: PlatformAdminContext }>();

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
    const rows = await basePrisma.$queryRaw<ResolvePlatformAdminSessionRow[]>`
      SELECT * FROM platform_admin_resolve_session(${tokenHash})
    `;
    const row = rows[0];
    if (!row) {
      throw new UnauthorizedError("INVALID_SESSION", "Session is invalid or has been revoked.");
    }

    if (row.expires_at.getTime() <= Date.now()) {
      // Read-only hot path, same as AuthGuard/GuardianAuthGuard — no delete here.
      throw new UnauthorizedError("SESSION_EXPIRED", "Session has expired. Please sign in again.");
    }

    if (!row.is_platform_admin) {
      // A real, live session — just not one that carries platform-admin
      // access. Recognized-but-forbidden, hence 403, not 401.
      throw new ForbiddenError("Platform admin access required.");
    }

    req.platformAdmin = {
      sessionId: row.session_id,
      userId: row.user_id,
    };
    return true;
  }
}
