import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";

import { Prisma, basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  GoneError,
  InternalError,
  NotFoundError,
  type AcceptInvitationInput,
  type AcceptInvitationResponse,
  type PublicInvitationDto,
} from "@school-kit/types";

import * as password from "../../common/auth/password";
import { createSession } from "../../common/auth/sessions";
import { redactEmail } from "../../common/redact";

const ACCEPT_AUDIT_ACTION = "invitation.accept";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface ResolveInvitationRow {
  invitation_id: string;
  school_id: string;
  email: string | null;
  role_key: string;
  first_name: string | null;
  last_name: string | null;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
}

@Injectable()
export class InvitationsService {
  // GET /invitations/:token — PUBLIC. Returns minimal data for the accept
  // page. Same status mapping as accept: 404 for unknown, 410 for expired
  // or already-accepted. We surface "already accepted" rather than 404 so
  // the UI can show a useful "this link has already been used" message
  // instead of a generic not-found.
  async getByToken(rawToken: string): Promise<PublicInvitationDto> {
    const row = await this.resolveOrThrow(rawToken);

    // schools is not under RLS, so we can read directly via basePrisma.
    const school = await basePrisma.school.findUnique({
      where: { id: row.school_id },
      select: { name: true, slug: true },
    });
    if (!school) {
      // Invitation references a school that no longer exists — treat as gone.
      throw new GoneError(
        "INVITATION_ALREADY_ACCEPTED",
        "This invitation is no longer valid.",
      );
    }

    // Inviter name is RLS-scoped — must go through withTenant.
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
      roleKey: row.role_key,
      email: row.email ?? "",
      firstName: row.first_name,
      lastName: row.last_name,
      invitedByName,
      expiresAt: row.expires_at,
    };
  }

  // POST /invitations/:token/accept — PUBLIC.
  //
  // The whole "claim → create user → assign role → audit" sequence runs
  // inside one withTenant() (which is itself a Prisma $transaction). The
  // claim step is `UPDATE ... WHERE acceptedAt IS NULL`; if the affected
  // row count is not 1 we throw, the transaction rolls back, and the
  // invitation is back to its pre-call state. The user row, the role grant,
  // and the audit row therefore either all commit OR none do — there is no
  // path where an invitation ends up marked accepted without a corresponding
  // user being created.
  //
  // The session is minted OUTSIDE this transaction (after commit), for the
  // same reason auth.service.signupOwner mints its session outside the
  // school-creation tx: a failure to mint a session is not a failure to
  // accept the invitation; the user can log in normally.
  async accept(
    rawToken: string,
    input: AcceptInvitationInput,
    ctx: RequestContext,
  ): Promise<AcceptInvitationResponse> {
    const row = await this.resolveOrThrow(rawToken);

    const passwordHash = await password.hashPassword(input.password);

    const created = await withTenant(row.school_id, async (db) => {
      // 1. Atomic claim. updateMany returns { count }, no throw on miss.
      //    The WHERE clause includes `acceptedAt: null`, so a concurrent
      //    accept that already flipped it to a timestamp will produce count=0
      //    here. Race-safe: Postgres locks the row during UPDATE.
      const claim = await db.invitation.updateMany({
        where: { id: row.invitation_id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claim.count !== 1) {
        // Either another request beat us to it, or the row's gone. Either
        // way, GoneError with the already-accepted code is honest.
        throw new GoneError(
          "INVITATION_ALREADY_ACCEPTED",
          "This invitation has already been used.",
        );
      }

      // 2. Email collision re-check inside the same tx. If a user with this
      //    email appeared between invite-time and accept-time, we abort —
      //    the claim's acceptedAt write rolls back with the rest of the tx.
      if (row.email) {
        const collision = await db.user.findFirst({
          where: { email: row.email },
          select: { id: true },
        });
        if (collision) {
          throw new ConflictError(
            "EMAIL_TAKEN",
            "A user with that email already exists in this school.",
          );
        }
      }

      // 3. Create the user. emailVerified=true because accepting the
      //    invitation proves the invitee controls the email it was sent to.
      const user = await db.user.create({
        data: {
          schoolId: row.school_id,
          email: row.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
          emailVerified: row.email !== null,
        },
        select: USER_RESPONSE_SELECT,
      });

      // 4. Assign the admin role. Look up the system role via basePrisma
      //    because roles has no RLS (system roles are shared across tenants;
      //    we filter by schoolId IS NULL + isSystem=true).
      const role = await basePrisma.role.findFirst({
        where: { schoolId: null, key: row.role_key, isSystem: true },
        select: { id: true },
      });
      if (!role) {
        // Seed bug — the role the invitation references doesn't exist.
        // Throw inside the tx so the whole accept rolls back.
        throw new InternalError(
          `System role '${row.role_key}' is not seeded. Run pnpm db:seed.`,
        );
      }
      await db.userRole.create({
        data: { userId: user.id, roleId: role.id },
      });

      // 5. Audit row. Same direct-write pattern as auth.service: belongs
      //    inside the tx so either we accepted-and-logged or did neither.
      await db.auditLog.create({
        data: {
          schoolId: row.school_id,
          userId: user.id,
          action: ACCEPT_AUDIT_ACTION,
          entityType: "invitation",
          entityId: row.invitation_id,
          ipAddress: ctx.ipAddress,
          metadata: {
            email: row.email ? redactEmail(row.email) : null,
            invitedBy: row.invited_by,
            roleKey: row.role_key,
          },
        },
      });

      return { user, schoolId: row.school_id };
    });

    // Session minted post-commit. See method-level comment for the rationale.
    const { rawToken: bearerToken } = await createSession(created.schoolId, created.user.id, ctx);

    // schools has no RLS — read via basePrisma. Same shape contract as
    // SignupOwnerResponse / LoginResponse so the client can treat all three
    // identically.
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: created.schoolId },
      select: SCHOOL_RESPONSE_SELECT,
    });

    return { user: created.user, school, token: bearerToken };
  }

  // Shared lookup: hash the raw token, call the SECURITY DEFINER function,
  // and apply the three status checks (404 / 410 expired / 410 accepted)
  // every public invitation endpoint runs at its entry.
  private async resolveOrThrow(rawToken: string): Promise<ResolveInvitationRow> {
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const rows = await basePrisma.$queryRaw<ResolveInvitationRow[]>`
      SELECT * FROM auth_resolve_invitation_by_token_hash(${tokenHash})
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundError("Invitation not found.");
    }
    // Order matters: already-accepted takes precedence over expired so a
    // user who already accepted their invitation but comes back after it
    // would have expired sees the more useful "already used" message.
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

// Mirrors the auth.service shape so the response from accept is identical
// to login/signup. Selects are explicit so a future schema addition doesn't
// silently leak through.

const USER_RESPONSE_SELECT = {
  id: true,
  schoolId: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  isActive: true,
  emailVerified: true,
  phoneVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const SCHOOL_RESPONSE_SELECT = {
  id: true,
  name: true,
  slug: true,
  motto: true,
  logoUrl: true,
  address: true,
  phone: true,
  email: true,
  primaryColor: true,
  status: true,
  onboardingStep: true,
  ndprConsent: true,
  ndprConsentAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SchoolSelect;
