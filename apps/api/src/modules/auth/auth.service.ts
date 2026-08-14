import * as crypto from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";

import { Prisma, applySchoolDefaults, basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  GoneError,
  InternalError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  type AuthMeRoleDto,
  type ForgotPasswordInput,
  type ForgotPasswordResponse,
  type LoginInput,
  type LoginResponse,
  type MeResponse,
  type ResetPasswordInput,
  type ResetPasswordResponse,
  type SignupOwnerInput,
  type SignupOwnerResponse,
  type TotpChallengeInput,
  type TotpConfirmInput,
  type TotpDisableInput,
  type TotpSetupResponseDto,
  type TotpStatusDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { EmailService } from "../../common/email/email.service.js";
import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider.js";
// Indirect through password.ts so tests can spy on hashPassword / verifyPassword.
// The argon2 package's CJS exports are non-configurable.
import * as password from "../../common/auth/password";
import { createSession } from "../../common/auth/sessions";
import { invalidateSessionCache } from "../../common/auth/session-cache.js";
import { redactEmail } from "../../common/redact";
import { generateUniqueSchoolSlug } from "../../common/slug/school-slug.js";
import { TotpService } from "./totp.service.js";

const SIGNUP_AUDIT_ACTION = "auth.signup_owner";
const LOGIN_AUDIT_ACTION = "auth.login";
const LOGIN_2FA_AUDIT_ACTION = "auth.login_2fa";
const LOGOUT_AUDIT_ACTION = "auth.logout";
const TOTP_ENABLE_AUDIT_ACTION = "auth.2fa.enable";
const TOTP_DISABLE_AUDIT_ACTION = "auth.2fa.disable";
const PASSWORD_RESET_REQUESTED_AUDIT_ACTION = "auth.password_reset_requested";
const PASSWORD_RESET_AUDIT_ACTION = "auth.password_reset";

const CHALLENGE_TTL_SECONDS = 300;
const CHALLENGE_KEY_PREFIX = "2fa:challenge:";

// Explicit override for signupOwner's $transaction below — Prisma's
// interactive-transaction default is 5000ms. Production incident
// 2026-08-02/03: that transaction runs ~12 sequential round-trips (school/
// user/role creation, class-level + class-arm + subject-catalogue +
// grading-scheme + grading-component + grade-boundary seeding, audit log),
// and real Neon latency (not the near-zero round-trip time of local Docker
// Postgres) pushed elapsed time to 5172ms — 172ms over the default —
// failing every signup with a 500 for ~2 hours before this fix. Prisma's
// own error message recommends exactly this remedy. 20s is generous
// headroom against Neon cold-start latency (CLAUDE.md's "Neon's 5-minute
// autosuspend" note) without holding a bootstrap-only, low-frequency
// transaction open dangerously long — signup has no concurrent writers to
// a brand-new school's rows to block.
const SIGNUP_TRANSACTION_TIMEOUT_MS = 20_000;

// Short-lived by design — much shorter than the 7-day invitation TTL.
// Industry-standard reasoning: a reset link is issued to prove control of an
// inbox RIGHT NOW, not "at some point this week"; a long-lived link sitting
// unused in an inbox is a bigger compromise window than a short one that
// just gets re-requested if missed.
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60; // 1 hour

// Same purpose as users.service.ts's webBaseUrl() / commit-teachers.row.ts's
// copy — duplicated rather than shared, matching this codebase's existing
// convention for this exact one-liner (see both call sites for the same
// "why not shared" non-reasoning: it's genuinely one line, not worth an
// import for two other modules to already duplicate).
function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? "http://localhost:3001";
}

// Fixed argon2id hash used as a target when login is attempted against an
// unknown email or a user without a password_hash. Verifying against it
// keeps total response time on the same order as a real verification, so
// an attacker cannot enumerate accounts by latency.
//
// Lazily generated on first miss (cached for the process lifetime). The
// plaintext is arbitrary and never used for anything but priming the cache.
// Exposed via getDummyVerifyHash() rather than a top-level await because
// the API compiles to CommonJS where top-level await is unavailable.
let dummyVerifyHash: string | null = null;
async function getDummyVerifyHash(): Promise<string> {
  if (!dummyVerifyHash) {
    dummyVerifyHash = await password.hashPassword("dummy-login-target");
  }
  return dummyVerifyHash;
}

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface LookupUserForLoginRow {
  user_id: string;
  school_id: string;
  password_hash: string;
  is_active: boolean;
}

interface LookupUserForPasswordResetRow {
  user_id: string;
  school_id: string;
  is_active: boolean;
}

interface ResolvePasswordResetTokenRow {
  reset_id: string;
  user_id: string;
  school_id: string;
  expires_at: Date;
  used_at: Date | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Default parameters allow `new AuthService()` in integration tests that
  // bypass the DI container. In production NestJS resolves both via DI:
  // TotpService/EmailService from providers, REDIS_AUTH_CLIENT from
  // RedisAuthModule. Tests that call 2FA/password-reset methods receive real
  // objects; tests that only call signup/login get the cheap defaults and
  // never touch the Redis/email paths.
  constructor(
    private readonly totpService: TotpService = new TotpService(),
    @Inject(REDIS_AUTH_CLIENT) private readonly redis: Redis = null as unknown as Redis,
    private readonly email: EmailService = null as unknown as EmailService,
  ) {}

  // Creates: School → User → UserRole (owner) → AuditLog in a single
  // transaction. Then mints a session row outside the tx and returns the
  // raw bearer token to the client (the token hash is what we persist).
  //
  // Atomicity: every row that belongs to "this new tenant exists" either all
  // commits or all rolls back. The session is intentionally outside that
  // boundary — failing to mint a session is not failing to create the
  // account; the user can log in. (See ADR-001 in docs/DECISIONS.md.)
  async signupOwner(input: SignupOwnerInput, ctx: RequestContext): Promise<SignupOwnerResponse> {
    // Pre-check email + phone uniqueness via a SECURITY DEFINER function.
    // We do this BEFORE hashing the password so the cheap rejection path
    // stays cheap. `users` is under FORCE RLS, which means a P2002 from
    // INSERT comes back with `target: null` and "Unique constraint failed
    // on the (not available)" — Postgres deliberately hides which field
    // collided. Without this pre-check we cannot tell email-taken from
    // phone-taken. See migration 20260515000000_add_signup_uniqueness_function.
    await this.assertEmailAndPhoneAvailable(input.ownerEmail, input.ownerPhone);

    // schoolSlug is optional on the wire (2026-08-12 — the signup form no
    // longer asks for it; see signup-owner.dto.ts for why). Derive it from
    // the school name when absent, using the same generator platform-admin
    // provisioning uses so both paths produce the same slug for the same
    // name. Done BEFORE the password hash for the same "cheap rejection
    // stays cheap" reason the uniqueness pre-check above is.
    const schoolSlug = input.schoolSlug ?? (await generateUniqueSchoolSlug(input.schoolName));

    const passwordHash = await password.hashPassword(input.password);

    let created: {
      schoolId: string;
      userId: string;
      school: Prisma.SchoolGetPayload<{ select: typeof SCHOOL_RESPONSE_SELECT }>;
      user: Prisma.UserGetPayload<{ select: typeof USER_RESPONSE_SELECT }>;
    };

    try {
      // Explicit timeout override — see SIGNUP_TRANSACTION_TIMEOUT_MS above
      // for why the 5000ms Prisma default isn't enough here.
      created = await basePrisma.$transaction(async (tx) => {
        const school = await tx.school.create({
          data: {
            name: input.schoolName,
            slug: schoolSlug,
            ndprConsent: true,
            ndprConsentAt: new Date(),
            // status, onboardingStep default per schema.
            // aiEnabled is stated explicitly even though it is currently
            // redundant with the schema default (2026-08-14). A new school
            // starting with AI OFF is a provisioning DECISION — AI is rolled
            // out one school at a time from platform-admin — not an incidental
            // consequence of whatever the column default happens to be. Saying
            // it here means a future default change cannot silently alter what
            // a newly signed-up school gets without someone deleting this line
            // on purpose. Enable via PATCH /platform-admin/schools/:id/ai.
            aiEnabled: false,
          },
          select: SCHOOL_RESPONSE_SELECT,
        });

        // From here on, every tenant-scoped INSERT must satisfy the policy's
        // WITH CHECK. Set the GUC inside the same tx so RLS sees the new
        // school's id as the current tenant.
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${school.id}, true)`;

        const user = await tx.user.create({
          data: {
            schoolId: school.id,
            firstName: input.ownerFirstName,
            lastName: input.ownerLastName,
            email: input.ownerEmail,
            phone: input.ownerPhone,
            passwordHash,
            // is_active, verification flags default per schema.
          },
          select: USER_RESPONSE_SELECT,
        });

        const ownerRole = await tx.role.findFirst({
          where: { schoolId: null, key: "owner", isSystem: true },
          select: { id: true },
        });
        if (!ownerRole) {
          // Configuration error — should be caught in CI via the integration
          // suite. If it happens in prod, fail loudly and roll back; do NOT
          // silently create a school without an owner role.
          throw new InternalError(
            "System role 'owner' is not seeded. Run `pnpm db:seed` against this database.",
          );
        }

        await tx.userRole.create({
          data: { userId: user.id, roleId: ownerRole.id },
        });

        // Seed the class levels, default arms, subject catalogue and grading
        // scheme/components/boundaries that make a brand-new school usable.
        //
        // Extracted to packages/db 2026-08-14 and shared with platform-admin
        // provisioning (PlatformAdminService.createSchool), which had been
        // creating schools WITHOUT any of this since 2026-08-07 — see that
        // file's header for the four schools it left unusable. Passing `tx`
        // directly, not withTenant: the GUC was set above on this same tx, and
        // a nested basePrisma.$transaction would hang. The 20s timeout this
        // transaction already carries is a precondition of the call, not an
        // incidental detail.
        await applySchoolDefaults(tx, school.id);

        // Audit entry written inline rather than queued through BullMQ. Two
        // reasons: (1) signup is the bootstrap event for the tenant — there
        // is no school_id yet when a queue worker would dequeue, so the
        // out-of-band write loses the atomicity we want here. (2) writing
        // inside the same tx as the school + user means we either record the
        // signup or we don't have a school at all — never an orphaned
        // user-without-audit-log. Once we have the audit interceptor for
        // post-auth mutations (Phase 0 Week 2), it queues via BullMQ; this
        // one signup write stays direct on purpose.
        await tx.auditLog.create({
          data: {
            schoolId: school.id,
            userId: user.id,
            action: SIGNUP_AUDIT_ACTION,
            entityType: "school",
            entityId: school.id,
            ipAddress: ctx.ipAddress,
            metadata: {
              schoolSlug: school.slug,
              ownerEmail: redactEmail(input.ownerEmail),
              // password / passwordHash / token are deliberately absent.
            },
          },
        });

        return {
          schoolId: school.id,
          userId: user.id,
          school,
          user,
        };
      }, { timeout: SIGNUP_TRANSACTION_TIMEOUT_MS });
    } catch (err) {
      throw translatePrismaError(err);
    }

    // Session creation outside the school+user transaction (see method
    // comment for why). Goes through withTenant so the RLS policy on
    // `sessions` is satisfied.
    const { rawToken } = await createSession(created.schoolId, created.userId, ctx);

    return {
      user: created.user,
      school: created.school,
      token: rawToken,
    };
  }

  // Email + password authentication. Login is the most-attacked endpoint we
  // ship, so the implementation is paranoid by design:
  //   1. Email lookup via SECURITY DEFINER (RLS chicken-and-egg — see
  //      auth.guard.ts and migration 20260516000000).
  //   2. On a miss, argon2.verify against a fixed dummy hash anyway so total
  //      response time is on the same order as a real verification — no
  //      latency-based account enumeration.
  //   3. Wrong password, unknown email, and deactivated account all return
  //      the SAME generic INVALID_CREDENTIALS error.
  //   4. Rate limiting is deliberately deferred (see docs/deferred.md).
  async login(input: LoginInput, ctx: RequestContext): Promise<LoginResponse> {
    const rows = await basePrisma.$queryRaw<LookupUserForLoginRow[]>`
      SELECT * FROM auth_lookup_user_for_login(${input.email})
    `;
    const row = rows[0];

    if (!row) {
      // Don't short-circuit — keep timing comparable to the row-found path.
      const dummy = await getDummyVerifyHash();
      await password.verifyPassword(dummy, input.password).catch(() => false);
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const passwordOk = await password
      .verifyPassword(row.password_hash, input.password)
      .catch(() => false);
    if (!passwordOk) {
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    if (!row.is_active) {
      // Same code as wrong-password. We do NOT want a deactivated user to
      // know whether the password they typed was correct.
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    // Check 2FA after password + is_active pass — schoolId is available from
    // the SD function result so we can scope straight to withTenant.
    const { totpEnabled } = await withTenant(row.school_id, (db) =>
      db.user.findUniqueOrThrow({
        where: { id: row.user_id },
        select: { totpEnabled: true },
      }),
    );

    if (totpEnabled) {
      // Issue a single-use, short-lived challenge token instead of a session.
      // The client must POST this token + a TOTP code to /auth/2fa/challenge.
      const challengeToken = crypto.randomBytes(32).toString("base64url");
      const key = `${CHALLENGE_KEY_PREFIX}${challengeToken}`;
      await this.redis.set(
        key,
        JSON.stringify({ userId: row.user_id, schoolId: row.school_id }),
        "EX",
        CHALLENGE_TTL_SECONDS,
      );
      return { requiresTwoFactor: true, challengeToken };
    }

    const { rawToken } = await createSession(row.school_id, row.user_id, ctx);

    const user = await withTenant(row.school_id, async (db) => {
      // Touch lastLoginAt + read back the public-shape user payload.
      const updatedUser = await db.user.update({
        where: { id: row.user_id },
        data: { lastLoginAt: new Date() },
        select: USER_RESPONSE_SELECT,
      });

      // Audit row — direct write, mirroring signup. Moves to the BullMQ
      // queue when the audit interceptor lands (see docs/deferred.md).
      await db.auditLog.create({
        data: {
          schoolId: row.school_id,
          userId: row.user_id,
          action: LOGIN_AUDIT_ACTION,
          entityType: "user",
          entityId: row.user_id,
          ipAddress: ctx.ipAddress,
          metadata: {
            ownerEmail: redactEmail(input.email),
            userAgent: ctx.userAgent,
          },
        },
      });

      return updatedUser;
    });

    // schools has no RLS — read via basePrisma. Matches the pattern used in
    // auth.service.spec.ts and the signup happy-path assertion.
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: row.school_id },
      select: SCHOOL_RESPONSE_SELECT,
    });

    return { requiresTwoFactor: false, user, school, token: rawToken };
  }

  // Completes a 2FA-gated login started by login(). The client submits the
  // challenge token it received + the current TOTP code. On a wrong code the
  // token is preserved in Redis so the user can retry within the 300 s TTL;
  // on a correct code the token is deleted (single-use) and a normal session
  // is issued. The per-endpoint throttle (5 attempts / 5 min) guards against
  // code enumeration.
  async loginWithChallenge(input: TotpChallengeInput, ctx: RequestContext): Promise<LoginResponse> {
    const key = `${CHALLENGE_KEY_PREFIX}${input.challengeToken}`;

    // GET without deleting: a wrong-code attempt must not consume the token
    // so the user can retry. The token is deleted explicitly below, only after
    // successful TOTP verification. The per-endpoint throttle is the
    // brute-force guard against code enumeration within the 300 s window.
    const raw = await this.redis.get(key);

    if (!raw) {
      // Timing-attack guard: run a dummy verifyCode so response time on a
      // missing/expired token stays comparable to a real wrong-code attempt
      // (which also goes through verifyCode). Without this, a timing oracle
      // could distinguish "token already used" from "code wrong".
      this.totpService.verifyCode("AAAAAAAAAAAAAAAAAAAAAAAAAAAA", "000000");
      throw new UnauthorizedError(
        "INVALID_2FA_CHALLENGE",
        "Challenge token is invalid or has expired.",
      );
    }

    const { userId, schoolId } = JSON.parse(raw) as { userId: string; schoolId: string };

    // Re-check is_active + fetch the live totp_secret inside the challenge
    // window. The user could be deactivated during the 300s TTL.
    const tfaUser = await withTenant(schoolId, (db) =>
      db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { isActive: true, totpSecret: true },
      }),
    );

    if (!tfaUser.isActive) {
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    if (!tfaUser.totpSecret || !this.totpService.verifyCode(tfaUser.totpSecret, input.code)) {
      throw new UnauthorizedError("INVALID_2FA_CODE", "Verification code is incorrect.");
    }

    // Consume the challenge token now that the code is verified. This is the
    // single-use enforcement point — a replay attempt after a successful login
    // finds no key and receives INVALID_2FA_CHALLENGE.
    await this.redis.del(key);

    const { rawToken } = await createSession(schoolId, userId, ctx);

    const user = await withTenant(schoolId, async (db) => {
      const updatedUser = await db.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
        select: USER_RESPONSE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId,
          userId,
          action: LOGIN_2FA_AUDIT_ACTION,
          entityType: "user",
          entityId: userId,
          ipAddress: ctx.ipAddress,
          metadata: { userAgent: ctx.userAgent },
        },
      });

      return updatedUser;
    });

    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: SCHOOL_RESPONSE_SELECT,
    });

    return { requiresTwoFactor: false, user, school, token: rawToken };
  }

  // Deletes the session row matching the current bearer token and writes an
  // audit entry. Idempotent on the row delete (deleteMany returns count
  // rather than throwing on missing rows), so a double-logout from two tabs
  // does not 500 the second one — though the second request's AuthGuard
  // will have already rejected with INVALID_SESSION before reaching here.
  //
  // Session cache invalidation (2026-07-31): AuthGuard now caches resolved
  // sessions for 30s (session-cache.ts). Without an explicit DEL here, a
  // logged-out session's bearer token would keep authenticating from cache
  // for up to 30s — select the tokenHash BEFORE the delete (the row is
  // about to disappear) so we can clear its cache entry too.
  async logout(authCtx: AuthContext, reqCtx: RequestContext): Promise<void> {
    const tokenHash = await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.session.findUnique({
        where: { id: authCtx.sessionId },
        select: { tokenHash: true },
      });

      await db.session.deleteMany({ where: { id: authCtx.sessionId } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: LOGOUT_AUDIT_ACTION,
          entityType: "session",
          entityId: authCtx.sessionId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            userAgent: reqCtx.userAgent,
          },
        },
      });

      return existing?.tokenHash ?? null;
    });

    if (tokenHash) {
      await invalidateSessionCache(this.redis, [tokenHash]);
    }
  }

  // POST /auth/forgot-password — PUBLIC. Issues a reset token if (and only
  // if) the email matches an active user, but ALWAYS returns the same
  // generic response either way — the account-enumeration guard here is
  // "the response never varies", same spirit as login()'s dummy-hash trick,
  // just applied to control flow instead of timing (no dummy-latency step:
  // unlike login, nothing here is comparing a caller-supplied secret, so the
  // stakes of a minor timing difference are much lower — see
  // auth_lookup_user_for_password_reset's migration header for the same
  // point made at the SQL layer).
  async forgotPassword(input: ForgotPasswordInput, ctx: RequestContext): Promise<ForgotPasswordResponse> {
    const GENERIC_RESPONSE: ForgotPasswordResponse = {
      message: "If an account exists for that email, we've sent password reset instructions.",
    };

    const rows = await basePrisma.$queryRaw<LookupUserForPasswordResetRow[]>`
      SELECT * FROM auth_lookup_user_for_password_reset(${input.email})
    `;
    const row = rows[0];

    // Unknown email or deactivated account: same non-committal response,
    // no token issued, no email sent. Deactivated is treated the same as
    // unknown for the same reason login() treats it the same as a wrong
    // password — we do not want this endpoint to reveal account state.
    if (!row || !row.is_active) {
      return GENERIC_RESPONSE;
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await withTenant(row.school_id, async (db) => {
      await db.passwordResetToken.create({
        data: {
          schoolId: row.school_id,
          userId: row.user_id,
          tokenHash,
          expiresAt,
        },
      });

      await db.auditLog.create({
        data: {
          schoolId: row.school_id,
          userId: row.user_id,
          action: PASSWORD_RESET_REQUESTED_AUDIT_ACTION,
          entityType: "user",
          entityId: row.user_id,
          ipAddress: ctx.ipAddress,
          metadata: {
            email: redactEmail(input.email),
            userAgent: ctx.userAgent,
          },
        },
      });
    });

    const resetUrl = `${webBaseUrl()}/reset-password/${rawToken}`;
    // Manual-copy fallback, same established pattern as guardian invite's
    // `[GUARDIAN INVITATION]` log line (guardians.service.ts) — logged
    // unconditionally, before the best-effort send below, so a Resend
    // outage never loses the link entirely.
    this.logger.log(`[PASSWORD RESET] ${resetUrl}`);

    try {
      await this.email.send({
        to: input.email,
        subject: "Reset your School Kit password",
        html: `<p>We received a request to reset your School Kit password. This link expires in 1 hour and can only be used once.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
      });
    } catch (err) {
      // Best-effort — same as guardian invite delivery. The token row is
      // already committed; a Resend failure here is logged, never thrown,
      // and never surfaced to the caller (which would leak account
      // existence via a differently-shaped error response).
      this.logger.warn(`Password reset email failed for ${redactEmail(input.email)}: ${String(err)}`);
    }

    return GENERIC_RESPONSE;
  }

  // POST /auth/reset-password — PUBLIC. Validates the token, overwrites
  // passwordHash, invalidates every existing session for the user (a stale
  // session surviving a password reset would defeat the point of resetting
  // it — e.g. a stolen session on a shared computer), and returns a plain
  // success message.
  //
  // Deliberately does NOT auto-login (unlike InvitationsService.accept,
  // which effectively is "create user + log in"). Two reasons: (1) if the
  // account has 2FA enabled, silently issuing a session here would bypass
  // that second factor entirely — reset-password proves control of an
  // inbox, not control of the authenticator app, and those are not the same
  // guarantee login() makes. Re-implementing login()'s totpEnabled branch
  // here just to preserve it would duplicate that logic for no real UX win.
  // (2) forcing a fresh sign-in after a reset is the conventional pattern
  // (and arguably the more honest one: "your password changed, prove you
  // know the new one before we trust this device again").
  async resetPassword(input: ResetPasswordInput, ctx: RequestContext): Promise<ResetPasswordResponse> {
    const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
    const rows = await basePrisma.$queryRaw<ResolvePasswordResetTokenRow[]>`
      SELECT * FROM auth_resolve_password_reset_token(${tokenHash})
    `;
    const row = rows[0];

    if (!row) {
      throw new NotFoundError("Password reset link not found.");
    }
    // Order matters, same rationale as InvitationsService.resolveOrThrow:
    // already-used takes precedence over expired so a user who already used
    // the link but comes back after it would also have expired sees the
    // more useful "already used" message.
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

    const killedTokenHashes = await withTenant(row.school_id, async (db) => {
      // Atomic claim, same race-safe pattern as InvitationsService.accept —
      // updateMany's WHERE includes usedAt: null, so a concurrent reset
      // attempt that already claimed the token produces count=0 here.
      const claim = await db.passwordResetToken.updateMany({
        where: { id: row.reset_id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new GoneError(
          "PASSWORD_RESET_ALREADY_USED",
          "This password reset link has already been used.",
        );
      }

      await db.user.update({
        where: { id: row.user_id },
        data: { passwordHash },
      });

      // Kill every existing session for this user — see method-level
      // comment for why this matters. Select tokenHashes BEFORE the delete
      // (the rows are about to disappear); the cache DEL itself happens
      // AFTER this transaction commits (see below), same pattern as
      // logout() — a Redis round-trip has no reason to extend how long this
      // Postgres transaction stays open.
      const killedSessions = await db.session.findMany({
        where: { userId: row.user_id },
        select: { tokenHash: true },
      });
      await db.session.deleteMany({ where: { userId: row.user_id } });

      await db.auditLog.create({
        data: {
          schoolId: row.school_id,
          userId: row.user_id,
          action: PASSWORD_RESET_AUDIT_ACTION,
          entityType: "user",
          entityId: row.user_id,
          ipAddress: ctx.ipAddress,
          metadata: { userAgent: ctx.userAgent },
        },
      });

      return killedSessions.map((s) => s.tokenHash);
    });

    // Without this, a stolen session on a shared computer would keep
    // authenticating from the 30s session cache (session-cache.ts) even
    // after the "kill all sessions" reset above — defeating the whole
    // point of that step.
    await invalidateSessionCache(this.redis, killedTokenHashes);

    return { message: "Password reset. Please sign in with your new password." };
  }

  // Returns the authenticated user, their school, and their roles +
  // flattened permission set.
  //
  // The user re-fetch + role grants both go through withTenant because
  // `users` and `user_roles` are under FORCE ROW LEVEL SECURITY — even a
  // direct basePrisma findUnique returns no rows without the GUC set.
  //
  // The original "use basePrisma like the school re-fetch" plan turned out
  // to assume basePrisma could bypass RLS; it can't. The risk that plan was
  // hedging against (silent USER_INACTIVE from a tenant mismatch) is
  // structurally impossible here anyway: AuthContext.schoolId comes from
  // auth_resolve_session, which joins users→sessions, so the tenant we
  // scope to is always the one that owns this user.
  //
  // is_active is re-checked below as belt-and-braces against AuthContext
  // staleness, even though AuthGuard already rejected !is_active.
  async getMe(authCtx: AuthContext): Promise<MeResponse> {
    type Grant = Prisma.UserRoleGetPayload<{ select: typeof ROLE_GRANT_SELECT }>;
    const { user, grants } = await withTenant(authCtx.schoolId, async (db) => {
      const u = await db.user.findUnique({
        where: { id: authCtx.userId },
        select: USER_RESPONSE_SELECT,
      });
      if (!u) return { user: null, grants: [] as Grant[] };
      const g = await db.userRole.findMany({
        where: { userId: authCtx.userId },
        select: ROLE_GRANT_SELECT,
      });
      return { user: u, grants: g };
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError("USER_INACTIVE", "Your account has been deactivated.");
    }

    // schools has no RLS — basePrisma read is fine.
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: authCtx.schoolId },
      select: SCHOOL_RESPONSE_SELECT,
    });

    const roles: AuthMeRoleDto[] = grants.map((g) => ({
      key: g.role.key,
      name: g.role.name,
      permissions: coercePermissions(g.role.permissions),
    }));

    // Flatten + dedupe. `*` short-circuits — once present, that's the whole
    // effective permission set.
    const flat = new Set<string>();
    for (const r of roles) {
      for (const p of r.permissions) flat.add(p);
    }
    const permissions = flat.has("*") ? ["*"] : Array.from(flat).sort();

    // paystackSubaccountBusinessName is never persisted — only PATCH
    // /schools/me's own return populates it, right after a fresh verify.
    return { user, school: { ...school, paystackSubaccountBusinessName: null }, roles, permissions };
  }

  // Returns whether 2FA is currently enabled for the authenticated user.
  async getTwoFactorStatus(userId: string, schoolId: string): Promise<TotpStatusDto> {
    const user = await withTenant(schoolId, (db) =>
      db.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabled: true } }),
    );
    return { enabled: user.totpEnabled };
  }

  // Generates a fresh TOTP secret, persists it as totp_pending_secret (not
  // totp_secret — 2FA is NOT active yet), and returns the otpauth:// URL
  // for QR display + the raw secret as text fallback. Calling setup again
  // overwrites any in-progress pending secret.
  async setupTwoFactor(userId: string, schoolId: string): Promise<TotpSetupResponseDto> {
    const secret = this.totpService.generateSecret();

    const user = await withTenant(schoolId, (db) =>
      db.user.update({
        where: { id: userId },
        data: { totpPendingSecret: secret },
        select: { email: true },
      }),
    );

    const otpAuthUrl = this.totpService.getOtpAuthUrl(secret, user.email ?? userId);
    return { otpAuthUrl, secret };
  }

  // Verifies the first TOTP code against totp_pending_secret. On success,
  // activates 2FA: totp_secret ← pending, totp_enabled ← true,
  // totp_pending_secret ← null. Writes an audit log.
  async confirmTwoFactor(
    userId: string,
    schoolId: string,
    input: TotpConfirmInput,
  ): Promise<void> {
    const user = await withTenant(schoolId, (db) =>
      db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { totpPendingSecret: true },
      }),
    );

    if (!user.totpPendingSecret) {
      throw new ValidationError("2FA setup has not been started. Call POST /auth/2fa/setup first.");
    }

    if (!this.totpService.verifyCode(user.totpPendingSecret, input.code)) {
      throw new UnauthorizedError("INVALID_2FA_CODE", "Verification code is incorrect.");
    }

    await withTenant(schoolId, async (db) => {
      await db.user.update({
        where: { id: userId },
        data: {
          totpSecret: user.totpPendingSecret,
          totpEnabled: true,
          totpPendingSecret: null,
        },
      });

      await db.auditLog.create({
        data: {
          schoolId,
          userId,
          action: TOTP_ENABLE_AUDIT_ACTION,
          entityType: "user",
          entityId: userId,
          metadata: {},
        },
      });
    });
  }

  // Disables 2FA after re-verifying the owner's current password (defence
  // against a stolen session enabling someone to disable 2FA). Clears all
  // three TOTP columns. Writes an audit log.
  async disableTwoFactor(
    userId: string,
    schoolId: string,
    input: TotpDisableInput,
  ): Promise<void> {
    const user = await withTenant(schoolId, (db) =>
      db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true, totpEnabled: true },
      }),
    );

    if (!user.totpEnabled) {
      throw new ValidationError("Two-factor authentication is not currently enabled.");
    }

    if (!user.passwordHash) {
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid password.");
    }

    const passwordOk = await password
      .verifyPassword(user.passwordHash, input.currentPassword)
      .catch(() => false);
    if (!passwordOk) {
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid password.");
    }

    await withTenant(schoolId, async (db) => {
      await db.user.update({
        where: { id: userId },
        data: { totpSecret: null, totpPendingSecret: null, totpEnabled: false },
      });

      await db.auditLog.create({
        data: {
          schoolId,
          userId,
          action: TOTP_DISABLE_AUDIT_ACTION,
          entityType: "user",
          entityId: userId,
          metadata: {},
        },
      });
    });
  }

  // Calls the SECURITY DEFINER function added in
  // 20260515000000_add_signup_uniqueness_function — returns two booleans
  // and never row data, so it leaks no cross-tenant information beyond
  // what the response itself would surface (a separate code per field).
  private async assertEmailAndPhoneAvailable(email: string, phone: string): Promise<void> {
    const rows = await basePrisma.$queryRaw<
      Array<{ email_taken: boolean; phone_taken: boolean }>
    >`SELECT * FROM auth_check_signup_uniqueness(${email}, ${phone})`;
    const check = rows[0];
    if (!check) {
      // Shouldn't happen — the SQL function always returns one row.
      throw new InternalError("Uniqueness pre-check returned no rows.");
    }
    if (check.email_taken) {
      throw new ConflictError("EMAIL_TAKEN", "An account with that email already exists.");
    }
    if (check.phone_taken) {
      throw new ConflictError("PHONE_TAKEN", "An account with that phone number already exists.");
    }
  }

}

// Selects — explicit so we never accidentally leak passwordHash, internal
// flags, or anything else added to the model in a future migration.

// Exported so other modules (e.g. UsersService.completeTour) return the
// exact same public-safe user shape instead of hand-rolling a second select
// that could drift (leak a field, or omit one the DTO expects).
export const USER_RESPONSE_SELECT = {
  id: true,
  schoolId: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  isActive: true,
  emailVerified: true,
  phoneVerified: true,
  tourCompletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const ROLE_GRANT_SELECT = {
  role: { select: { key: true, name: true, permissions: true } },
} satisfies Prisma.UserRoleSelect;

// Wider than the original signup-only shape — matches SchoolMeDto so the
// /auth/me response can hydrate the onboarding wizard's forms without
// requiring a second round-trip to GET /schools/me on every page mount.
// Signup + login still return the same shape (defaults / nulls) which is
// fine: the SchoolMeDto interface accepts nullable fields throughout.
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
  subjectAttendanceEnabled: true,
  paystackSubaccountCode: true,
  paystackPaymentsEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SchoolSelect;

// Role.permissions is a Json column — Prisma types it as JsonValue. We
// store either `["*"]` or `string[]`. Anything else is a seed bug.
function coercePermissions(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string");
}

// Map Prisma unique-constraint errors into typed ConflictErrors with stable
// sub-codes the client can branch on. Everything else passes through.
//
// Prisma's `meta.target` shape varies — sometimes it's the field name array
// (['email']), sometimes the index name as a string ('users_email_key'),
// occasionally undefined. We build a single search haystack from target +
// error message so substring matches against the field name catch every
// observed shape, with the message as a final fallback.
function translatePrismaError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = (err.meta as { target?: unknown } | undefined)?.target;
    const fields: string[] = Array.isArray(target)
      ? target.map((t) => String(t))
      : typeof target === "string"
        ? [target]
        : [];
    const haystack = (fields.join(",") + " " + (err.message ?? "")).toLowerCase();

    if (haystack.includes("slug")) {
      return new ConflictError("SCHOOL_SLUG_TAKEN", "That school slug is already taken.");
    }
    if (haystack.includes("email")) {
      return new ConflictError("EMAIL_TAKEN", "An account with that email already exists.");
    }
    if (haystack.includes("phone")) {
      return new ConflictError("PHONE_TAKEN", "An account with that phone number already exists.");
    }
    return new ConflictError("UNIQUE_VIOLATION", "That value is already taken.");
  }
  return err;
}
