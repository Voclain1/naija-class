import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ForbiddenError,
  NotFoundError,
  type DeactivateStudentPortalResponse,
  type IssueStudentInvitationResponse,
  type StudentPortalState,
  type StudentPortalStatusDto,
  type ReleasedResultDetailDto,
  type ReleasedResultListResponse,
} from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import { ReleasedResultsService } from "../report-cards/released-results.service";

// Phase 6 / Slice 3 — the guardian's controls over their child's portal
// access: issue an invitation, read the state, and turn it off.
//
// Lives on the /portal surface behind GuardianAuthGuard, which is the whole
// reason none of this needs a SECURITY DEFINER function (D21): the guardian
// is already authenticated, so their session has already resolved a
// school_id. The pre-tenant chicken-and-egg that forces SD everywhere else in
// the auth layer simply does not arise — these are ordinary withTenant writes
// governed by RLS like any other tenant mutation.

const INVITE_AUDIT_ACTION = "student.portal-invitation-issued";
const DEACTIVATE_AUDIT_ACTION = "student.deactivate";

/** Shorter than the guardian invitation's — a child's link is more likely to sit unread in a family chat. */
export const STUDENT_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

@Injectable()
export class StudentAccessService {
  constructor(private readonly releasedResults: ReleasedResultsService) {}

  // ---------------------------------------------------------------------
  // D27 — authorization is an EXPLICIT check that RAISES, performed BEFORE
  // and SEPARATELY from the write. Never inferred from rowCount.
  //
  // This exists because of a measured finding, not a hypothetical. Tested as
  // app_user with a valid school GUC — exactly a guardian's request context —
  // against real RLS:
  //
  //   * RLS does NOT protect one family from another. A guardian not linked
  //     to a child in the SAME SCHOOL can see that child, and a plain
  //     UPDATE on them SUCCEEDS. Tenancy was never the boundary in question.
  //
  //   * Folding the check into the write's WHERE clause
  //     (`UPDATE ... WHERE id = ? AND EXISTS (link)`) yields rowCount 0 for
  //     BOTH "not linked" and "no such student" — which must be 403 and 404
  //     respectively. A service branching on rowCount cannot tell them apart.
  //     (It does NOT conflate "already deactivated", which returns 1, since
  //     UPDATE counts rows matched rather than changed — worth stating,
  //     because that is the failure people expect and it is not the one that
  //     bites.)
  //
  // So: resolve the student, then the link, raising distinct errors, and only
  // then write — unscoped by the link. The write is deliberately NOT
  // defensively re-scoped: a write whose safety depends on its own WHERE
  // clause is a write whose safety cannot be asserted independently, and this
  // check is that assertion. Both run inside one transaction, so the check
  // cannot go stale between check and write.
  // ---------------------------------------------------------------------
  private async assertLinked(
    db: Parameters<Parameters<typeof withTenant>[1]>[0],
    guardianId: string,
    studentId: string,
  ): Promise<void> {
    const student = await db.student.findUnique({
      where: { id: studentId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundError("Student not found.");
    }

    const link = await db.studentGuardian.findFirst({
      where: { studentId, guardianId },
      select: { id: true },
    });
    if (!link) {
      throw new ForbiddenError(
        "NOT_LINKED_TO_STUDENT",
        "You do not have access to this student.",
      );
    }
  }

  async getStatus(
    ctx: GuardianAuthContext,
    studentId: string,
  ): Promise<StudentPortalStatusDto> {
    return withTenant(ctx.schoolId, async (db) => {
      await this.assertLinked(db, ctx.guardianId, studentId);

      const student = await db.student.findUniqueOrThrow({
        where: { id: studentId },
        select: { id: true, passwordHash: true, activatedAt: true, lastLoginAt: true },
      });

      const pending = await db.studentPortalInvitation.findFirst({
        where: {
          studentId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        select: { expiresAt: true },
      });

      return {
        studentId: student.id,
        state: derivePortalState(student.activatedAt, student.passwordHash),
        activatedAt: student.activatedAt,
        lastLoginAt: student.lastLoginAt,
        hasPendingInvitation: pending !== null,
        pendingInvitationExpiresAt: pending?.expiresAt ?? null,
      };
    });
  }

  // Issues a single-use invitation. Returns the raw token EXACTLY ONCE;
  // only its sha256 hash is persisted, the same contract as every other token
  // in this codebase.
  //
  // Issuing revokes any previously-outstanding invitation, so at most one
  // live token exists per student at any moment. Enforced here rather than by
  // a partial unique index because "live" is a three-column predicate that
  // includes `expires_at > now()`, and now() is not immutable.
  async issueInvitation(
    ctx: GuardianAuthContext,
    studentId: string,
    reqCtx: { ipAddress: string | null },
  ): Promise<IssueStudentInvitationResponse> {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + STUDENT_INVITATION_TTL_MS);

    return withTenant(ctx.schoolId, async (db) => {
      await this.assertLinked(db, ctx.guardianId, studentId);

      const revoked = await db.studentPortalInvitation.updateMany({
        where: { studentId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      const invitation = await db.studentPortalInvitation.create({
        data: {
          schoolId: ctx.schoolId,
          studentId,
          tokenHash,
          issuedBy: ctx.guardianId,
          expiresAt,
        },
        select: { id: true },
      });

      await db.auditLog.create({
        data: {
          schoolId: ctx.schoolId,
          userId: ctx.guardianId, // the GUARDIAN is the actor, not the child
          action: INVITE_AUDIT_ACTION,
          entityType: "student",
          entityId: studentId,
          ipAddress: reqCtx.ipAddress,
          metadata: { invitationId: invitation.id, revokedPrevious: revoked.count },
        },
      });

      return {
        invitationId: invitation.id,
        token: rawToken,
        expiresAt,
        revokedPrevious: revoked.count,
      };
    });
  }

  // D25/D26 — turn the child's account off, for real.
  //
  // Three writes in ONE transaction, and the third is what makes this a
  // revocation rather than a gesture:
  //   1. password_hash = NULL      -> no future sign-in
  //   2. delete every session      -> live sessions die on the next request
  //   3. revoke every live invite  -> nothing the child (or anyone they
  //                                   forwarded the link to) still holds can
  //                                   be replayed
  //
  // Without (3), a child could simply re-open the invitation link, set a new
  // password, and be back in — an "off" switch that tells a parent access is
  // revoked when it is not.
  //
  // Reactivation is NOT this endpoint run in reverse: the guardian must
  // deliberately issue a FRESH invitation. There is no path from off to on
  // that does not pass through an explicit parental act.
  //
  // Idempotent: deactivating an already-deactivated child succeeds with zero
  // counts rather than erroring. "Make sure this is off" is a reasonable
  // thing for a worried parent to do twice.
  async deactivate(
    ctx: GuardianAuthContext,
    studentId: string,
    reqCtx: { ipAddress: string | null },
  ): Promise<DeactivateStudentPortalResponse> {
    return withTenant(ctx.schoolId, async (db) => {
      await this.assertLinked(db, ctx.guardianId, studentId);

      // Unscoped by the link on purpose — see assertLinked's header.
      await db.student.update({
        where: { id: studentId },
        data: { passwordHash: null },
      });

      const sessions = await db.studentSession.deleteMany({ where: { studentId } });
      const invitations = await db.studentPortalInvitation.updateMany({
        where: { studentId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Phase 6 / Slice 5 (D40). A push token outlives the session it was
      // registered under — it is an address Expo holds, not a credential we
      // check — so without this a parent who just switched their child's
      // account off would watch notifications keep arriving on the child's
      // phone. That is the same "false safety control" D26 rejected: it
      // tells a parent they have revoked access while something they can
      // still see says otherwise.
      //
      // In THIS transaction, beside the session delete, for the same reason
      // the session delete is here rather than in a cleanup job: revocation
      // has to be complete at the moment the parent taps the button.
      const devices = await db.deviceToken.deleteMany({ where: { studentId } });

      const after = await db.student.findUniqueOrThrow({
        where: { id: studentId },
        select: { activatedAt: true, passwordHash: true },
      });

      await db.auditLog.create({
        data: {
          schoolId: ctx.schoolId,
          userId: ctx.guardianId,
          action: DEACTIVATE_AUDIT_ACTION,
          entityType: "student",
          entityId: studentId,
          ipAddress: reqCtx.ipAddress,
          // Counts are recorded so "did it actually take effect?" is
          // answerable after the fact rather than inferred.
          metadata: {
            sessionsRevoked: sessions.count,
            invitationsRevoked: invitations.count,
            deviceTokensRevoked: devices.count,
          },
        },
      });

      return {
        studentId,
        state: derivePortalState(after.activatedAt, after.passwordHash),
        sessionsRevoked: sessions.count,
        invitationsRevoked: invitations.count,
      };
    });
  }

  // ---------------------------------------------------------------------
  // Phase 6 / Slice 4 — the GUARDIAN half of results (D29).
  //
  // These live here rather than in PortalStudentsService for one reason:
  // assertLinked is private to this class, and cross-family authorization is
  // the entire security question on this read. Reaching for it from another
  // service would mean widening it to public, which is how a check that
  // currently cannot be skipped becomes one that can.
  //
  // Both methods delegate to the SAME ReleasedResultsService instance method
  // the student's own endpoints call. That shared call is what makes
  // "nothing is shown to the student earlier than to the guardian" (D28)
  // structural rather than a convention — no RELEASED filter appears in this
  // file, and if one ever did, that would be the drift D28 exists to
  // prevent.
  //
  // Note the ORDER: assertLinked runs before the read, inside the same
  // transaction, exactly as it does for the three writes above. A read is
  // where it is most tempting to fold the ownership check into the query's
  // WHERE clause — which would collapse "not your child" and "no results
  // yet" into the same empty list, and lose the 403 entirely.
  // ---------------------------------------------------------------------
  async listResults(
    ctx: GuardianAuthContext,
    studentId: string,
  ): Promise<ReleasedResultListResponse> {
    return withTenant(ctx.schoolId, async (db) => {
      await this.assertLinked(db, ctx.guardianId, studentId);
      return { data: await this.releasedResults.listForStudent(db, studentId) };
    });
  }

  async getResult(
    ctx: GuardianAuthContext,
    studentId: string,
    termId: string,
  ): Promise<ReleasedResultDetailDto> {
    return withTenant(ctx.schoolId, async (db) => {
      await this.assertLinked(db, ctx.guardianId, studentId);
      return this.releasedResults.getForStudent(db, studentId, termId);
    });
  }
}

// Portal state is DERIVED, never stored (D25). A dedicated column would be a
// second copy of something these two already say, free to drift from them.
export function derivePortalState(
  activatedAt: Date | null,
  passwordHash: string | null,
): StudentPortalState {
  if (passwordHash) return "ACTIVE";
  return activatedAt ? "DEACTIVATED" : "NEVER_ACTIVATED";
}
