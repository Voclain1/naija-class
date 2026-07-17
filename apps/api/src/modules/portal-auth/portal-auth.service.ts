import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";

import { Prisma, basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
  type AcceptGuardianInvitationInput,
  type AcceptGuardianInvitationResponse,
  type GuardianLoginInput,
  type GuardianLoginResponse,
  type PublicGuardianInvitationDto,
} from "@school-kit/types";

import * as password from "../../common/auth/password";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { redactEmail } from "../../common/redact";

const LOGIN_AUDIT_ACTION = "guardian.login";
const ACCEPT_AUDIT_ACTION = "guardian-invitation.accept";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface LookupGuardianForLoginRow {
  guardian_id: string;
  school_id: string;
  password_hash: string;
}

interface ResolveGuardianInvitationRow {
  invitation_id: string;
  school_id: string;
  guardian_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
}

// Fixed argon2id hash for the timing-attack defense on an unknown email,
// same rationale and pattern as AuthService's dummyVerifyHash (auth.service.ts).
// Kept as a SEPARATE cache (not shared with staff) so the two auth surfaces
// have no coupling — an implementation detail that could otherwise leak
// through a shared module's import graph.
let dummyVerifyHash: string | null = null;
async function getDummyVerifyHash(): Promise<string> {
  if (!dummyVerifyHash) {
    dummyVerifyHash = await password.hashPassword("dummy-guardian-login-target");
  }
  return dummyVerifyHash;
}

@Injectable()
export class PortalAuthService {
  // POST /portal/login — PUBLIC.
  //
  // Multi-candidate verify (interim strategy, option ii — approved
  // 2026-07-16, see docs/modules/phase-4.md slice 2 plan-first "login
  // disambiguation" and CLAUDE.md's SECURITY DEFINER inventory note on
  // auth_lookup_guardians_for_login). Guardian.email is unique only per
  // school (Decision C), so the same email can return multiple candidate
  // rows across different schools. We verify the password against every
  // candidate rather than stopping at the first match, both to keep timing
  // comparable across the zero/one/many-match cases and because stopping
  // early could silently authenticate against the WRONG school if the
  // first row happens to share the same password by coincidence.
  //
  // Exactly one match: proceed. Zero matches: INVALID_CREDENTIALS (same
  // generic error for wrong-password and unknown-email, matching staff
  // login). More than one match (a guardian who reused the same password
  // at two schools): this is a genuine ambiguity the interim strategy
  // does not resolve — AMBIGUOUS_GUARDIAN_ACCOUNT, distinct from
  // INVALID_CREDENTIALS so the portal can show a real explanation rather
  // than "wrong password" for a guardian who typed everything correctly.
  async login(input: GuardianLoginInput, ctx: RequestContext): Promise<GuardianLoginResponse> {
    const rows = await basePrisma.$queryRaw<LookupGuardianForLoginRow[]>`
      SELECT * FROM auth_lookup_guardians_for_login(${input.email})
    `;

    if (rows.length === 0) {
      const dummy = await getDummyVerifyHash();
      await password.verifyPassword(dummy, input.password).catch(() => false);
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const matches: LookupGuardianForLoginRow[] = [];
    for (const row of rows) {
      const ok = await password.verifyPassword(row.password_hash, input.password).catch(() => false);
      if (ok) matches.push(row);
    }

    if (matches.length === 0) {
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    if (matches.length > 1) {
      throw new ConflictError(
        "AMBIGUOUS_GUARDIAN_ACCOUNT",
        "This email and password match guardian accounts at more than one school. " +
          "Contact support to sign in.",
      );
    }

    const [match] = matches;

    const { rawToken } = await createGuardianSession(match.school_id, match.guardian_id, ctx);

    const guardian = await withTenant(match.school_id, async (db) => {
      const updated = await db.guardian.update({
        where: { id: match.guardian_id },
        data: { lastLoginAt: new Date() },
        select: GUARDIAN_LOGIN_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: match.school_id,
          // Guardian id, not a User id — audit_logs.user_id carries no FK
          // constraint (see schema.prisma:201), so this is safe; "who
          // performed this action" is the intent, not specifically a staff
          // User.
          userId: match.guardian_id,
          action: LOGIN_AUDIT_ACTION,
          entityType: "guardian",
          entityId: match.guardian_id,
          ipAddress: ctx.ipAddress,
          metadata: {
            email: redactEmail(input.email),
            userAgent: ctx.userAgent,
          },
        },
      });

      return updated;
    });

    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: match.school_id },
      select: GUARDIAN_LOGIN_SCHOOL_SELECT,
    });

    return { guardian, school, token: rawToken };
  }

  // GET /portal/invitations/:token — PUBLIC.
  async getByToken(rawToken: string): Promise<PublicGuardianInvitationDto> {
    const row = await this.resolveOrThrow(rawToken);

    const school = await basePrisma.school.findUnique({
      where: { id: row.school_id },
      select: { name: true, slug: true },
    });
    if (!school) {
      throw new GoneError(
        "INVITATION_ALREADY_ACCEPTED",
        "This invitation is no longer valid.",
      );
    }

    const inviter = await withTenant(row.school_id, (db) =>
      db.user.findUnique({
        where: { id: row.invited_by },
        select: { firstName: true, lastName: true },
      }),
    );
    const invitedByName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`.trim()
      : "An administrator";

    return {
      schoolName: school.name,
      schoolSlug: school.slug,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      invitedByName,
      expiresAt: row.expires_at,
    };
  }

  // POST /portal/invitations/:token/accept — PUBLIC.
  //
  // Unlike staff's accept (which CREATES a User), this sets passwordHash +
  // emailVerified on the EXISTING Guardian row — the guardian already
  // exists, created earlier when a student was linked (see
  // GuardianInvitation's schema comment). No email-collision re-check is
  // needed for that same reason: there is no new row whose email could
  // collide with anything.
  //
  // Session minted OUTSIDE the transaction, same rationale as every other
  // accept/signup flow in this codebase (failing to mint a session is not
  // failing to accept).
  async acceptInvitation(
    rawToken: string,
    input: AcceptGuardianInvitationInput,
    ctx: RequestContext,
  ): Promise<AcceptGuardianInvitationResponse> {
    const row = await this.resolveOrThrow(rawToken);

    const passwordHash = await password.hashPassword(input.password);

    const accepted = await withTenant(row.school_id, async (db) => {
      const claim = await db.guardianInvitation.updateMany({
        where: { id: row.invitation_id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new GoneError(
          "INVITATION_ALREADY_ACCEPTED",
          "This invitation has already been used.",
        );
      }

      const guardian = await db.guardian.update({
        where: { id: row.guardian_id },
        data: {
          passwordHash,
          emailVerified: row.email !== null,
        },
        select: GUARDIAN_LOGIN_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: row.school_id,
          userId: row.guardian_id,
          action: ACCEPT_AUDIT_ACTION,
          entityType: "guardian-invitation",
          entityId: row.invitation_id,
          ipAddress: ctx.ipAddress,
          metadata: {
            email: row.email ? redactEmail(row.email) : null,
            invitedBy: row.invited_by,
          },
        },
      });

      return guardian;
    });

    const { rawToken: bearerToken } = await createGuardianSession(
      row.school_id,
      row.guardian_id,
      ctx,
    );

    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: row.school_id },
      select: GUARDIAN_LOGIN_SCHOOL_SELECT,
    });

    return { guardian: accepted, school, token: bearerToken };
  }

  // Shared lookup: hash the raw token, call the SECURITY DEFINER function,
  // apply the same 404 / already-accepted-before-expired / expired status
  // mapping as staff's InvitationsService.resolveOrThrow.
  private async resolveOrThrow(rawToken: string): Promise<ResolveGuardianInvitationRow> {
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const rows = await basePrisma.$queryRaw<ResolveGuardianInvitationRow[]>`
      SELECT * FROM auth_resolve_guardian_invitation_by_token_hash(${tokenHash})
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundError("Invitation not found.");
    }
    if (row.accepted_at !== null) {
      throw new GoneError(
        "INVITATION_ALREADY_ACCEPTED",
        "This invitation has already been used.",
      );
    }
    if (row.expires_at.getTime() <= Date.now()) {
      throw new GoneError(
        "INVITATION_EXPIRED",
        "This invitation has expired. Ask for a new one.",
      );
    }
    return row;
  }
}

const GUARDIAN_LOGIN_SELECT = {
  id: true,
  schoolId: true,
  firstName: true,
  lastName: true,
  email: true,
} satisfies Prisma.GuardianSelect;

const GUARDIAN_LOGIN_SCHOOL_SELECT = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.SchoolSelect;
