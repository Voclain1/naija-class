import * as crypto from "node:crypto";

import { withTenant } from "@school-kit/db";

// Same TTL as staff sessions (sessions.ts) — no product reason for these to
// differ, and a single shared constant would be premature abstraction across
// two genuinely separate session mechanisms (see GuardianSession's schema
// comment for why it's a parallel table, not a reuse of Session).
export const GUARDIAN_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface CreateGuardianSessionContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Mints a guardian_sessions row and returns the raw bearer token. Mirrors
// createSession (sessions.ts) exactly: only the sha256 hash is persisted,
// the raw bytes are returned once and never stored.
//
// Goes through withTenant so the RLS policy on guardian_sessions (which
// joins through guardians.school_id) is satisfied.
export async function createGuardianSession(
  schoolId: string,
  guardianId: string,
  ctx: CreateGuardianSessionContext,
): Promise<{ rawToken: string }> {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await withTenant(schoolId, (db) =>
    db.guardianSession.create({
      data: {
        guardianId,
        tokenHash,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        expiresAt: new Date(Date.now() + GUARDIAN_SESSION_TTL_MS),
      },
    }),
  );

  return { rawToken };
}
