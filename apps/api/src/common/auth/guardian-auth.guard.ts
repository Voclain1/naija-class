import * as crypto from "node:crypto";
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { basePrisma } from "@school-kit/db";
import { UnauthorizedError } from "@school-kit/types";

import type { GuardianAuthContext } from "./guardian-auth-context";

// Bearer-token guard for the guardian portal, reading the token the portal's
// Next.js proxy route forwards from its httpOnly sk_portal_session cookie
// (apps/portal has no direct browser-to-API path — see ARCHITECTURE.md §12).
// Mirrors AuthGuard (auth.guard.ts) exactly; see that file's header for the
// full "why SECURITY DEFINER" / "why strict Bearer casing" rationale, which
// applies identically here.
//
// What we DO attach to req.guardian: { sessionId, guardianId, schoolId }.
// What we DELIBERATELY DON'T: email, name. Handlers that need guardian
// contact info re-fetch via withTenant.
//
// Unlike AuthGuard, there is no user_is_active-equivalent check here —
// Guardian has no is_active column (flagged as a follow-up gap in the
// 20260716000000_phase_4_slice_2_guardian_auth migration header; the only
// way to revoke portal access today is clearing passwordHash, which this
// guard doesn't need to check since a cleared passwordHash cannot have
// produced a valid session in the first place — sessions are minted only
// on successful login/accept, both of which require a passwordHash to exist).
const BEARER_PREFIX = "Bearer ";

interface ResolveGuardianSessionRow {
  session_id: string;
  guardian_id: string;
  school_id: string;
  expires_at: Date;
}

@Injectable()
export class GuardianAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { guardian?: GuardianAuthContext }>();

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
    const rows = await basePrisma.$queryRaw<ResolveGuardianSessionRow[]>`
      SELECT * FROM auth_resolve_guardian_session(${tokenHash})
    `;
    const row = rows[0];
    if (!row) {
      throw new UnauthorizedError("INVALID_SESSION", "Session is invalid or has been revoked.");
    }

    if (row.expires_at.getTime() <= Date.now()) {
      // Read-only hot path, same as AuthGuard — no delete here.
      throw new UnauthorizedError("SESSION_EXPIRED", "Session has expired. Please sign in again.");
    }

    req.guardian = {
      sessionId: row.session_id,
      guardianId: row.guardian_id,
      schoolId: row.school_id,
    };
    return true;
  }
}
