import * as crypto from "node:crypto";

import { withTenant } from "@school-kit/db";

// Seed a `roleKey='teacher'` Invitation row directly through the tenant client.
//
// WHY THE DB AND NOT AN API CALL — the documented cp4 divergence:
//   The cp4 brief asks for inviteAndAcceptTeacher to create the invitation via
//   `POST /users/invite` with roleKey='teacher'. That endpoint does not exist
//   in that shape: in Phase 0 it is admin-only and hardcodes `roleKey:"admin"`
//   (apps/api/src/modules/users/users.service.ts). The only API paths that mint
//   a teacher invitation today are the async bulk-teacher CSV import (BullMQ
//   worker — too heavy and flake-prone to drive from an E2E setup step) and the
//   slice-13 RBAC rollup (not yet built). The cp4 brief explicitly sanctions
//   "fetch the invitation directly from the DB" as an acceptable approach, so
//   we seed the row here and let the REAL public accept flow
//   (GET/POST /invitations/:token) + REAL login do everything else.
//
//   The accept handler (apps/api/src/modules/invitations/invitations.service.ts)
//   is role-generic — it grants whatever `role_key` the invitation row carries.
//   So a seeded teacher invitation, once accepted through the UI, produces a
//   genuine teacher: real password, real session, real `teacher` role grant.
//   The ONLY synthetic step is the row insert; when a teacher-invite API lands
//   in slice 13, swap this one function for that call — the accept half of
//   inviteAndAcceptTeacher is already production-faithful and stays untouched.
//
// The insert goes through withTenant (RLS sets app.current_school_id) exactly
// as the real UsersService.invite does — same INSERT policy, same columns.

const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days, matching the API.

export interface SeededInvitation {
  rawToken: string;
  acceptPath: string; // relative to the web baseURL, e.g. /invitations/<token>
}

export async function seedTeacherInvitation(opts: {
  schoolId: string;
  invitedByUserId: string;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<SeededInvitation> {
  // Same token construction the API uses: a 32-byte base64url secret is the
  // bearer; only its SHA-256 hash is stored. The raw token goes in the URL.
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  await withTenant(opts.schoolId, async (db) => {
    await db.invitation.create({
      data: {
        schoolId: opts.schoolId,
        email: opts.email,
        firstName: opts.firstName,
        lastName: opts.lastName,
        roleKey: "teacher",
        tokenHash,
        invitedBy: opts.invitedByUserId,
        expiresAt,
      },
    });
  });

  return { rawToken, acceptPath: `/invitations/${rawToken}` };
}
