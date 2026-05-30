import * as crypto from "node:crypto";

import { Logger } from "@nestjs/common";

import { Prisma, type PrismaClient } from "@school-kit/db";
import type { TeacherImportRow } from "@school-kit/types";

import { CommitRowError } from "./commit-guardians.row";

// Per-row commit for TEACHERS (slice 10 cp2). Each good row becomes ONE
// Invitation with roleKey="teacher" — the bulk equivalent of the Phase 0
// POST /users/invite flow (which hardcodes roleKey="admin"). The teacher
// accepts at /invitations/:token, which mints the User + grants the
// `teacher` role (seeded by slice 10 cp1's migration). No TeacherProfile
// is created here — the admin creates that after acceptance (Q2 lifecycle).
//
// SCHEMA NOTE (diverges from the cp2 task's assumed shape): the Invitation
// model has NO `roleId`, NO `status` column, and NO (email, schoolId)
// unique — its only unique is `token_hash`. It stores `roleKey` (a string),
// resolved to a role at ACCEPT time. So:
//   - we set roleKey="teacher" directly (no role-id lookup needed); the
//     teacher-role SEED matters for the accept flow, not for invite
//     creation.
//   - "invitation already exists for this email" cannot be a P2002 (no such
//     unique). It's enforced application-level, exactly like
//     UsersService.invite's INVITATION_ALREADY_PENDING guard: a findFirst
//     for an unexpired, unaccepted invitation. Found → commit-time bad row.
//
// The already-a-User case is handled UPSTREAM by the validate engine's
// external check (re-run at commit time by the handler), so it doesn't need
// re-checking here — same split as guardians (student-exists at validate,
// link-exists at commit).

// 7 days — same value as UsersService.INVITATION_TTL_MS (kept local because
// that constant is private to users.service.ts; both derive from "a week of
// inbox attention is plenty"). When Resend email delivery lands these merge
// into a per-school setting.
const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

// Where the accept URL points. Mirrors UsersService.webBaseUrl(). Production
// MUST set WEB_BASE_URL; dev defaults to the :3001 web port.
function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? "http://localhost:3001";
}

const logger = new Logger("commitTeacherRow");

export async function commitTeacherRow(
  row: TeacherImportRow,
  schoolId: string,
  userId: string,
  db: PrismaClient,
): Promise<void> {
  // 1. Guard against an existing unexpired, unaccepted invitation for this
  //    email — same rule as UsersService.invite. Two invitations for one
  //    email would leave the admin unsure which accept link is live.
  const pending = await db.invitation.findFirst({
    where: {
      email: row.email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (pending) {
    throw new CommitRowError(
      "email",
      "Invitation already exists for this email.",
    );
  }

  // 2. Mint the token + hash (same shape as UsersService.invite). The raw
  //    token never touches the DB — only its sha256 hash.
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  // 3. Create the invitation. roleKey="teacher" (resolved at accept time).
  try {
    await db.invitation.create({
      data: {
        schoolId,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        roleKey: "teacher",
        tokenHash,
        invitedBy: userId,
        expiresAt,
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      // The only unique on invitations is token_hash — a collision here is
      // astronomically unlikely (32 random bytes). Treat as a recoverable
      // per-row failure so the rest of the import proceeds; a re-upload
      // mints a fresh token.
      throw new CommitRowError(
        "email",
        "Could not create invitation (token collision); please retry this row.",
      );
    }
    throw e;
  }

  // 4. Email delivery via Resend is deferred (Phase 4) — log the accept URL
  //    so an operator can retrieve it from logs, exactly as
  //    UsersService.invite does for the single-invite flow. The URL
  //    contains the raw token; logging the URL (not the bare token) is the
  //    established, intentional pattern.
  const acceptUrl = `${webBaseUrl()}/invitations/${rawToken}`;
  logger.log(`[INVITATION] ${acceptUrl}`);
}
