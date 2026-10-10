import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

import { Prisma, basePrisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type InviteAdminInput,
  type InviteAdminResponse,
  type InvitationCreatedDto,
  type PendingInvitationDto,
  type ResendStaffInvitationResponse,
  type RevokeStaffInvitationResponse,
  type SignupOwnerUserDto,
  type UserListItemDto,
  type UserRoleDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { redactEmail } from "../../common/redact";
import { USER_RESPONSE_SELECT } from "../auth/auth.service";

// 7 days. Slice 6's onboarding step 3 uses the same value inline; both copies
// agree because both copies derive from "1 week of inbox attention is plenty
// for a small private school's admin chain". When email delivery via Resend
// lands, this becomes a per-school setting and these two constants merge.
const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const INVITE_AUDIT_ACTION = "user.invite";
const INVITE_RESEND_AUDIT_ACTION = "user.invite-resend";
const INVITE_REVOKE_AUDIT_ACTION = "user.invite-revoke";

// Where the accept URL points. Dev default matches the web dev port noted in
// .env.example. Production deploys MUST set WEB_BASE_URL explicitly; we don't
// throw on a missing value here because a misconfigured prod would still
// successfully create the invitation row — the URL would just be wrong,
// which is recoverable (re-issue) rather than catastrophic.
function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? "http://localhost:3001";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  // GET /users — owner|admin lists active+inactive users in their school,
  // excluding themselves so the table is "other users" rather than "me + others".
  async listUsers(authCtx: AuthContext): Promise<UserListItemDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.user.findMany({
        where: { id: { not: authCtx.userId } },
        select: USER_LIST_SELECT,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toUserListItem);
    });
  }

  // GET /users/invitations — owner|admin lists pending (not accepted AND not
  // expired) invitations. The inviter is looked up in a second query because
  // Invitation has no Prisma relation to User (invitedBy is a bare FK, kept
  // bare because future invitations may come from system actors that don't
  // have a User row).
  async listPendingInvitations(authCtx: AuthContext): Promise<PendingInvitationDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const invitations = await db.invitation.findMany({
        where: {
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (invitations.length === 0) return [];

      const inviterIds = Array.from(new Set(invitations.map((i) => i.invitedBy)));
      const inviters = await db.user.findMany({
        where: { id: { in: inviterIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      const inviterMap = new Map(inviters.map((u) => [u.id, u]));

      return invitations.map((inv) => {
        const inviter = inviterMap.get(inv.invitedBy);
        return {
          id: inv.id,
          email: inv.email ?? "",
          firstName: inv.firstName,
          lastName: inv.lastName,
          roleKey: inv.roleKey,
          invitedBy: {
            id: inv.invitedBy,
            // If the inviter has been deleted (cascading from a removed user)
            // we fall back to a neutral label rather than crashing the list.
            firstName: inviter?.firstName ?? "Unknown",
            lastName: inviter?.lastName ?? "",
          },
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
        };
      });
    });
  }

  // POST /users/invite — owner|admin invites a new admin, bursar, or teacher
  // (slice 15 added roleKey for admin/bursar; teacher added 2026-07-31 —
  // see inviteAdminSchema's header comment for why this needed no new
  // plumbing beyond the allow-list).
  //
  // Six gates, in order, before any write:
  //   1. role check (owner|admin), with belt-and-braces is_active re-check
  //   2. roleKey re-validated against the known allow-list server-side —
  //      never trust the client's value, even though ZodValidationPipe
  //      already restricts it to the enum at the HTTP boundary (direct
  //      service callers bypass the pipe entirely)
  //   3. school must be ACTIVE (not still ONBOARDING) — onboarding invites
  //      go through POST /onboarding/3 specifically
  //   4. email must not match an existing user in this school
  //   5. email must not match an outstanding (pending+unexpired) invitation
  //   6. the raw token is generated; the hash is stored
  //
  // Atomicity: invitation row + audit row write inside one withTenant
  // transaction so a failure rolls both back. The console log happens AFTER
  // the commit — logging a URL for a transaction that rolled back would
  // confuse the operator.
  async invite(
    authCtx: AuthContext,
    input: InviteAdminInput,
    reqCtx: RequestContext,
  ): Promise<InviteAdminResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const roleKey = input.roleKey ?? "admin";
    if (roleKey !== "admin" && roleKey !== "bursar" && roleKey !== "teacher") {
      // Unreachable via the HTTP path (ZodValidationPipe/inviteAdminSchema
      // already rejects anything outside the enum) — this is the
      // defence-in-depth check for direct service callers.
      throw new ValidationError(
        "INVALID_ROLE_KEY",
        "roleKey must be 'admin', 'bursar', or 'teacher'.",
      );
    }

    const school = await basePrisma.school.findUnique({
      where: { id: authCtx.schoolId },
      select: { status: true },
    });
    if (!school) {
      // AuthGuard proved this schoolId existed; if it's missing now the
      // tenant was deleted between guard and handler. 404 is honest.
      throw new NotFoundError("School not found.");
    }
    if (school.status !== "ACTIVE") {
      throw new ConflictError(
        "SCHOOL_NOT_ACTIVE",
        "Invitations can only be sent once onboarding is complete.",
      );
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const created = await withTenant(authCtx.schoolId, async (db) => {
      const existingUser = await db.user.findFirst({
        where: { email: input.email },
        select: { id: true },
      });
      if (existingUser) {
        throw new ConflictError(
          "EMAIL_TAKEN",
          "A user with that email already belongs to this school.",
        );
      }

      const pending = await db.invitation.findFirst({
        where: {
          email: input.email,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (pending) {
        throw new ConflictError(
          "INVITATION_ALREADY_PENDING",
          "An unexpired invitation has already been sent to that email.",
        );
      }

      const invitation = await db.invitation.create({
        data: {
          schoolId: authCtx.schoolId,
          email: input.email,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          roleKey,
          tokenHash,
          invitedBy: authCtx.userId,
          expiresAt,
        },
        select: INVITATION_CREATED_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: INVITE_AUDIT_ACTION,
          entityType: "invitation",
          entityId: invitation.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            email: redactEmail(input.email),
            roleKey,
            // firstName / lastName intentionally not in audit metadata —
            // they're on the invitation row directly now.
          },
        },
      });

      return invitation;
    });

    const acceptUrl = `${webBaseUrl()}/invitations/${rawToken}`;

    // Email delivery via Resend is deferred to Phase 4. For now, log the
    // accept URL to the server console so the operator can copy it manually
    // (the admin UI also shows it in a "Copy link" affordance immediately
    // after creation). The token itself is NOT logged — only the URL, which
    // contains the token; this is intentional: the URL is the thing an
    // operator needs to share, and grepping logs for "[INVITATION]" should
    // surface exactly the same string the admin would copy.
    this.logger.log(`[INVITATION] ${acceptUrl}`);

    return {
      invitation: toInvitationCreatedDto(created),
      token: rawToken,
      acceptUrl,
    };
  }

  // POST /users/invitations/:id/resend and /revoke (2026-10-08). Before these,
  // a staff invitation's link was shown once, at creation, and an admin who
  // lost it or sent it to the wrong person could only wait out the 7 days.
  //
  // An invitation is "ended" by moving its expiry to now, the way the
  // platform admin cancels an owner invitation: the accept page then reads it
  // as expired, and the row stays as a record. Owner invitations are out of
  // scope here: before a school has an owner they belong to the platform
  // admin, and after it they no longer exist to resend.

  /** Ends the invitation and issues a fresh link to the same person, same role. */
  async resendInvitation(
    authCtx: AuthContext,
    invitationId: string,
    reqCtx: RequestContext,
  ): Promise<ResendStaffInvitationResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const created = await withTenant(authCtx.schoolId, async (db) => {
      const old = await this.findStaffInvitation(db, invitationId);
      if (old.acceptedAt) {
        throw new ConflictError("INVITATION_ALREADY_ACCEPTED", "This invitation has already been accepted.");
      }
      if (old.email) {
        const existingUser = await db.user.findFirst({ where: { email: old.email }, select: { id: true } });
        if (existingUser) {
          throw new ConflictError("EMAIL_TAKEN", "A user with that email already belongs to this school.");
        }
      }

      const now = new Date();
      if (old.expiresAt > now) {
        await db.invitation.update({ where: { id: old.id }, data: { expiresAt: now } });
      }
      const invitation = await db.invitation.create({
        data: {
          schoolId: authCtx.schoolId,
          email: old.email,
          firstName: old.firstName,
          lastName: old.lastName,
          roleKey: old.roleKey,
          tokenHash,
          invitedBy: authCtx.userId,
          expiresAt,
        },
        select: INVITATION_CREATED_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: INVITE_RESEND_AUDIT_ACTION,
          entityType: "invitation",
          entityId: invitation.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { replaces: old.id, email: redactEmail(old.email), roleKey: old.roleKey },
        },
      });

      return invitation;
    });

    const acceptUrl = `${webBaseUrl()}/invitations/${rawToken}`;
    this.logger.log(`[INVITATION] ${acceptUrl}`);
    return { invitation: toInvitationCreatedDto(created), token: rawToken, acceptUrl };
  }

  /** Ends a pending invitation; the link already sent stops working. */
  async revokeInvitation(
    authCtx: AuthContext,
    invitationId: string,
    reqCtx: RequestContext,
  ): Promise<RevokeStaffInvitationResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const invitation = await this.findStaffInvitation(db, invitationId);
      const now = new Date();
      if (invitation.acceptedAt || invitation.expiresAt <= now) {
        throw new ConflictError("NO_PENDING_INVITATION", "This invitation is no longer pending.");
      }
      await db.invitation.update({ where: { id: invitation.id }, data: { expiresAt: now } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: INVITE_REVOKE_AUDIT_ACTION,
          entityType: "invitation",
          entityId: invitation.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { email: redactEmail(invitation.email), roleKey: invitation.roleKey },
        },
      });

      return { invitationId: invitation.id, revokedAt: now };
    });
  }

  private async findStaffInvitation(db: PrismaClient, invitationId: string) {
    // RLS keeps this to the caller's school; a malformed id is simply not found.
    const invitation = UUID_RE.test(invitationId)
      ? await db.invitation.findUnique({
          where: { id: invitationId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            roleKey: true,
            expiresAt: true,
            acceptedAt: true,
          },
        })
      : null;
    if (!invitation || invitation.roleKey === "owner") throw new NotFoundError("Invitation not found.");
    return invitation;
  }

  // POST /users/me/complete-tour — no role gate: every authenticated user
  // (owner, admin, teacher, bursar) may mark their own tour done. Self-
  // scoped by authCtx.userId, never a body-supplied id.
  async completeTour(authCtx: AuthContext): Promise<SignupOwnerUserDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      return db.user.update({
        where: { id: authCtx.userId },
        data: { tourCompletedAt: new Date() },
        select: USER_RESPONSE_SELECT,
      });
    });
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

const USER_LIST_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  isActive: true,
  emailVerified: true,
  phoneVerified: true,
  lastLoginAt: true,
  createdAt: true,
  roles: {
    select: {
      role: { select: { key: true, name: true } },
    },
  },
  teacherProfile: { select: { id: true } },
} satisfies Prisma.UserSelect;

type UserListRow = Prisma.UserGetPayload<{ select: typeof USER_LIST_SELECT }>;

function toUserListItem(row: UserListRow): UserListItemDto {
  const roles: UserRoleDto[] = row.roles.map((r) => ({
    key: r.role.key,
    name: r.role.name,
  }));
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    isActive: row.isActive,
    emailVerified: row.emailVerified,
    phoneVerified: row.phoneVerified,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    roles,
    teacherProfileId: row.teacherProfile?.id ?? null,
  };
}

const INVITATION_CREATED_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  roleKey: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.InvitationSelect;

type InvitationCreatedRow = Prisma.InvitationGetPayload<{
  select: typeof INVITATION_CREATED_SELECT;
}>;

function toInvitationCreatedDto(row: InvitationCreatedRow): InvitationCreatedDto {
  return {
    id: row.id,
    email: row.email ?? "",
    firstName: row.firstName,
    lastName: row.lastName,
    roleKey: row.roleKey,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
