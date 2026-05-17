import * as crypto from "node:crypto";

import { withTenant } from "@school-kit/db";

// 30 days. Matches the value AuthService originally held inline; lifted
// here so login, signup, and invitation accept all use the same number
// without one being able to drift from the others. If this ever becomes
// user-configurable per school, it goes through a SchoolSettings row, not
// a constructor argument.
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface CreateSessionContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Mints a session row for {schoolId, userId} and returns the raw bearer
// token. We persist only the sha256 hash of the token; the raw bytes are
// returned to the caller and never stored.
//
// Goes through withTenant so the RLS policy on `sessions` (which joins
// through users.school_id) is satisfied.
//
// Originally a private method on AuthService. Lifted to common/auth/ when
// Slice 7's invitations.service.ts needed it without dragging the whole
// AuthService into its DI graph.
export async function createSession(
  schoolId: string,
  userId: string,
  ctx: CreateSessionContext,
): Promise<{ rawToken: string }> {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await withTenant(schoolId, (db) =>
    db.session.create({
      data: {
        userId,
        tokenHash,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    }),
  );

  return { rawToken };
}
