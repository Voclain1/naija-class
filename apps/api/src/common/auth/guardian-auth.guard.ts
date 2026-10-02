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
// portal_enabled is this guard's user_is_active (2026-10-02, migration
// 20261002120000_guardian_portal_deactivation). It is re-read on every
// request — there is no cache here — so a school switching a parent's access
// off takes effect on that parent's next request, whatever sessions they
// hold. Deactivation also deletes those sessions; this check is what makes
// the switch authoritative even if that delete had not happened. Before it,
// the only lever was clearing passwordHash, which stopped future sign-ins but
// left a live session running for up to 30 days.
const BEARER_PREFIX = "Bearer ";

interface ResolveGuardianSessionRow {
  session_id: string;
  guardian_id: string;
  school_id: string;
  expires_at: Date;
  portal_enabled: boolean;
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

    if (!row.portal_enabled) {
      // The same code AuthGuard uses for a deactivated staff account, on
      // purpose: the app already maps USER_INACTIVE to "Your account is no
      // longer active. Contact your school administrator.", which is exactly
      // what a parent needs to hear, and the portal maps it the same way.
      throw new UnauthorizedError("USER_INACTIVE", "Your school has switched off portal access for this account.");
    }

    req.guardian = {
      sessionId: row.session_id,
      guardianId: row.guardian_id,
      schoolId: row.school_id,
    };
    return true;
  }
}
