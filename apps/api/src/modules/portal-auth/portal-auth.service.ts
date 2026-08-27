import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

import { Prisma, basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
  type AcceptGuardianInvitationInput,
  type AcceptGuardianInvitationResponse,
  type GuardianForgotPasswordInput,
  type GuardianForgotPasswordResponse,
  type GuardianLoginInput,
  type GuardianLoginResponse,
  type GuardianResetPasswordInput,
  type GuardianResetPasswordResponse,
  type PublicGuardianInvitationDto,
} from "@school-kit/types";

import * as password from "../../common/auth/password";
import { EmailService } from "../../common/email/email.service";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { redactEmail } from "../../common/redact";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";

const LOGIN_AUDIT_ACTION = "guardian.login";
const ACCEPT_AUDIT_ACTION = "guardian-invitation.accept";
const LOGOUT_AUDIT_ACTION = "guardian.logout";
const PASSWORD_RESET_REQUESTED_AUDIT_ACTION = "guardian.password-reset.requested";
const PASSWORD_RESET_COMPLETED_AUDIT_ACTION = "guardian.password-reset.completed";

// One hour, matching the staff reset TTL (auth.service.ts). Short enough that
// a link sitting in a shared or forwarded inbox stops working quickly; long
// enough for a parent who checks email on a phone later in the day.
const GUARDIAN_PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;

function portalBaseUrl(): string {
  // Same helper shape as guardians.service.ts — the API constructs portal
  // URLs for delivery but never follows them. Production must set
  // PORTAL_BASE_URL explicitly (see CLAUDE.md); dev falls back to :3002.
  return process.env.PORTAL_BASE_URL ?? "http://localhost:3002";
}

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface LookupGuardianForLoginRow {
  guardian_id: string;
  school_id: string;
  password_hash: string;
}

interface LookupGuardianForPasswordResetRow {
  guardian_id: string;
  school_id: string;
  school_name: string;
}

interface ResolveGuardianPasswordResetRow {
  reset_id: string;
  guardian_id: string;
  school_id: string;
  expires_at: Date;
  used_at: Date | null;
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
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(private readonly email: EmailService) {}

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

  // POST /portal/logout — requires GuardianAuthGuard.
  //
  // Deletes the guardian_sessions row for the CURRENT session only, never
  // every session for the guardian: signing out on the school computer must
  // not sign you out on your phone. (Password RESET is the opposite case and
  // does kill them all — see resetPassword.)
  //
  // Simpler than staff logout in one specific way, and it is worth saying why
  // rather than leaving the absence to look like an oversight:
  // AuthService.logout must also DEL the Redis session cache, because
  // AuthGuard reads through that cache. GuardianAuthGuard has NO cache — it
  // calls auth_resolve_guardian_session on every request — so deleting the
  // row IS the revocation, effective on the very next request. If a guardian
  // session cache is ever introduced, this method must gain the same
  // invalidation staff logout has.
  //
  // Idempotent: deleteMany, not delete, so a double-submit or an
  // already-swept session returns 204 rather than a 404 that would tell the
  // caller nothing useful.
  async logout(guardianCtx: GuardianAuthContext, ctx: RequestContext): Promise<void> {
    await withTenant(guardianCtx.schoolId, async (db) => {
      await db.guardianSession.deleteMany({ where: { id: guardianCtx.sessionId } });

      await db.auditLog.create({
        data: {
          schoolId: guardianCtx.schoolId,
          // Guardian id, not a User id — same as login() above; audit_logs
          // .user_id carries no FK constraint.
          userId: guardianCtx.guardianId,
          action: LOGOUT_AUDIT_ACTION,
          entityType: "guardian-session",
          entityId: guardianCtx.sessionId,
          ipAddress: ctx.ipAddress,
          metadata: { userAgent: ctx.userAgent },
        },
      });
    });
  }

  // POST /portal/forgot-password — PUBLIC.
  //
  // ACCOUNT-ENUMERATION GUARD: the response never varies. Unknown email,
  // known-but-never-invited email, and a real portal account all return the
  // identical message with the identical status. Mirrors staff
  // forgotPassword, whose comment explains why control-flow invariance (not
  // timing padding) is the right guard here: nothing in this method compares
  // a caller-supplied secret.
  //
  // THE GUARDIAN-SPECIFIC WRINKLE. Guardian.email is unique only per school
  // (Decision C), so one address can own portal accounts at several schools.
  // Login resolves that ambiguity by verifying the typed password against
  // each candidate. Recovery has no secret to resolve it with — so it does
  // not try to pick one. It issues a SEPARATE token per matching account and
  // sends a SEPARATE email per account, each naming its school. Every token
  // resets exactly one account.
  //
  // That is not an enumeration leak: the school names travel only to the
  // inbox, whose owner already holds all of those accounts. The HTTP
  // response still says nothing at all.
  async forgotPassword(
    input: GuardianForgotPasswordInput,
    ctx: RequestContext,
  ): Promise<GuardianForgotPasswordResponse> {
    const GENERIC_RESPONSE: GuardianForgotPasswordResponse = {
      message:
        "If an account exists for that email, we have sent password reset instructions.",
    };

    // The SQL function already filters to password_hash IS NOT NULL, so a
    // guardian who was never invited cannot acquire a password here — that
    // would be an activation backdoor around the invitation flow.
    const rows = await basePrisma.$queryRaw<LookupGuardianForPasswordResetRow[]>`
      SELECT * FROM auth_lookup_guardians_for_password_reset(${input.email})
    `;

    for (const row of rows) {
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + GUARDIAN_PASSWORD_RESET_TTL_MS);

      await withTenant(row.school_id, async (db) => {
        await db.guardianPasswordResetToken.create({
          data: {
            schoolId: row.school_id,
            guardianId: row.guardian_id,
            tokenHash,
            expiresAt,
          },
        });

        await db.auditLog.create({
          data: {
            schoolId: row.school_id,
            userId: row.guardian_id,
            action: PASSWORD_RESET_REQUESTED_AUDIT_ACTION,
            entityType: "guardian",
            entityId: row.guardian_id,
            ipAddress: ctx.ipAddress,
            metadata: {
              email: redactEmail(input.email),
              userAgent: ctx.userAgent,
            },
          },
        });
      });

      const resetUrl = `${portalBaseUrl()}/reset-password/${rawToken}`;
      // Manual-copy fallback, same established pattern as the guardian
      // invite's [GUARDIAN INVITATION] line — logged unconditionally and
      // BEFORE the best-effort send, so a Resend outage never loses the link
      // entirely. This is a server log, the same trust boundary the staff
      // reset already uses for the same reason.
      this.logger.log(`[GUARDIAN PASSWORD RESET] ${resetUrl}`);

      try {
        await this.email.send({
          to: input.email,
          subject: `Reset your ${row.school_name} parent portal password`,
          html:
            `<p>We received a request to reset the password for your ` +
            `<strong>${escapeHtml(row.school_name)}</strong> parent portal account.</p>` +
            `<p>This link expires in 1 hour and can only be used once.</p>` +
            `<p><a href="${resetUrl}">${resetUrl}</a></p>` +
            `<p>If you did not request this, you can safely ignore this email — ` +
            `your password will not change.</p>`,
        });
      } catch (err) {
        // Best-effort, exactly like staff forgotPassword: a mail-provider
        // failure must not change the response (that would leak existence)
        // and must not roll back the token (the logged URL above is still a
        // usable recovery path for support).
        this.logger.error(
          `Guardian password reset email to ${redactEmail(input.email)} failed`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    return GENERIC_RESPONSE;
  }

  // POST /portal/reset-password — PUBLIC.
  //
  // Does NOT auto-login, deliberately. Staff resetPassword established this
  // convention and the reasoning transfers: an invitation-accept is a
  // first-time enrolment (and does return a session), whereas a reset is
  // recovery on an existing account and should re-enter the normal,
  // rate-limited login path. It also means a leaked reset link cannot be
  // converted straight into a live session without the new password being
  // typed at the login form.
  async resetPassword(
    input: GuardianResetPasswordInput,
    ctx: RequestContext,
  ): Promise<GuardianResetPasswordResponse> {
    const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
    const rows = await basePrisma.$queryRaw<ResolveGuardianPasswordResetRow[]>`
      SELECT * FROM auth_resolve_guardian_password_reset_token(${tokenHash})
    `;
    const row = rows[0];

    if (!row) {
      throw new NotFoundError("Password reset link not found.");
    }
    // Order matters, same rationale as resolveOrThrow and staff
    // resetPassword: already-used takes precedence over expired, so someone
    // who used the link and comes back later gets the more useful message.
    if (row.used_at !== null) {
      throw new GoneError(
        "PASSWORD_RESET_ALREADY_USED",
        "This password reset link has already been used.",
      );
    }
    if (row.expires_at.getTime() <= Date.now()) {
      throw new GoneError(
        "PASSWORD_RESET_EXPIRED",
        "This password reset link has expired. Request a new one.",
      );
    }

    const passwordHash = await password.hashPassword(input.password);

    await withTenant(row.school_id, async (db) => {
      // ATOMIC single-use claim, same race-safe pattern as acceptInvitation
      // and staff resetPassword: usedAt: null is in the WHERE, so a
      // concurrent second attempt gets count = 0 rather than both
      // succeeding. This — not the read above — is where single-use is
      // actually enforced.
      const claim = await db.guardianPasswordResetToken.updateMany({
        where: { id: row.reset_id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new GoneError(
          "PASSWORD_RESET_ALREADY_USED",
          "This password reset link has already been used.",
        );
      }

      await db.guardian.update({
        where: { id: row.guardian_id },
        data: { passwordHash },
      });

      // Kill EVERY session for this guardian. Unlike logout (current session
      // only), a reset is what someone does when they believe their account
      // may be compromised — leaving other sessions alive would defeat the
      // point. GuardianAuthGuard has no cache, so this delete IS the whole
      // revocation and takes effect on the next request.
      await db.guardianSession.deleteMany({ where: { guardianId: row.guardian_id } });

      // Burn any OTHER outstanding reset tokens for this guardian, so an
      // older link still sitting in the inbox cannot be replayed to set a
      // different password after this one succeeded.
      await db.guardianPasswordResetToken.updateMany({
        where: { guardianId: row.guardian_id, usedAt: null },
        data: { usedAt: new Date() },
      });

      await db.auditLog.create({
        data: {
          schoolId: row.school_id,
          userId: row.guardian_id,
          action: PASSWORD_RESET_COMPLETED_AUDIT_ACTION,
          entityType: "guardian",
          entityId: row.guardian_id,
          ipAddress: ctx.ipAddress,
          metadata: { userAgent: ctx.userAgent },
        },
      });
    });

    return { message: "Your password has been reset. You can now sign in." };
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


// Minimal HTML escape for the one interpolated value in the reset email (the
// school's own name). School names are school-controlled input and this
// string is rendered as HTML in a mail client — escaping is cheap, and the
// alternative is trusting that no school ever registers a name containing an
// angle bracket. The reset URL itself is not escaped: it is base64url plus a
// known origin, with no user-controlled segment.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
