import * as crypto from "node:crypto";

import { withTenant } from "@school-kit/db";

// Same TTL as staff and guardian sessions. No product reason for these to
// differ, and a shared constant across three genuinely separate session
// mechanisms would be premature abstraction — see GuardianSession's schema
// comment for the same reasoning applied one principal earlier.
export const STUDENT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface CreateStudentSessionContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Mints a student_sessions row and returns the raw bearer token.
//
// Mirrors createGuardianSession exactly: 32 random bytes, base64url, only the
// sha256 hash persisted, raw bytes returned once and never stored. Goes
// through withTenant so the RLS policy on student_sessions — which joins
// through students.school_id — is satisfied.
export async function createStudentSession(
  schoolId: string,
  studentId: string,
  ctx: CreateStudentSessionContext,
): Promise<{ rawToken: string }> {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await withTenant(schoolId, (db) =>
    db.studentSession.create({
      data: {
        studentId,
        tokenHash,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        expiresAt: new Date(Date.now() + STUDENT_SESSION_TTL_MS),
      },
    }),
  );

  return { rawToken };
}

/** sha256 of a raw bearer token. The only form ever persisted or compared. */
export function hashStudentToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
