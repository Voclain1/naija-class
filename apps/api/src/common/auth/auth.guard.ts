import * as crypto from "node:crypto";
import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type Redis from "ioredis";

import { basePrisma } from "@school-kit/db";
import { UnauthorizedError } from "@school-kit/types";

import type { AuthContext } from "./auth-context";
import { REDIS_AUTH_CLIENT } from "./redis-auth.provider.js";
import { getCachedSession, setCachedSession } from "./session-cache.js";

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
//
// Redis session cache (2026-07-31, closing the #4 production-stall
// investigation in docs/deferred.md): every request used to pay a live
// Postgres round-trip here — measured as a consistent 150-350ms tax on
// EVERY call, not occasionally. Now checks the cache first; on a miss it
// falls back to the exact same DB path and populates the cache before
// returning. 30s TTL (session-cache.ts) is a safety net, not the primary
// revocation mechanism — logout, password-reset, and user deactivation all
// call invalidateSessionCache() directly so a revoked session stops working
// immediately. See session-cache.ts for the full reasoning.
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
  constructor(@Inject(REDIS_AUTH_CLIENT) private readonly redis: Redis) {}

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

    let row: ResolveSessionRow | null = null;

    const cached = await getCachedSession(this.redis, tokenHash);
    if (cached) {
      row = {
        session_id: cached.session_id,
        user_id: cached.user_id,
        school_id: cached.school_id,
        expires_at: new Date(cached.expires_at),
        user_is_active: cached.user_is_active,
      };
    } else {
      // SECURITY DEFINER function — bypasses RLS for this lookup ONLY.
      // Returns at most one row.
      const rows = await basePrisma.$queryRaw<ResolveSessionRow[]>`
        SELECT * FROM auth_resolve_session(${tokenHash})
      `;
      row = rows[0] ?? null;
      if (row) {
        // Only positive results are cached — an invalid/unknown token always
        // re-checks the DB, so this cache can never mask a session that was
        // never valid in the first place.
        await setCachedSession(this.redis, tokenHash, {
          session_id: row.session_id,
          user_id: row.user_id,
          school_id: row.school_id,
          expires_at: row.expires_at.toISOString(),
          user_is_active: row.user_is_active,
        });
      }
    }

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
