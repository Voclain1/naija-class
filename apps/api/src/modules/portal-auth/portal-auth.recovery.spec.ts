import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  UnauthorizedError,
  guardianForgotPasswordSchema,
  guardianLoginSchema,
  guardianResetPasswordSchema,
} from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { PortalAuthService } from "./portal-auth.service";

// Integration spec — real Postgres, real RLS. Covers guardian logout and
// password recovery (F-06), which had NO server-side implementation at all
// before this PR: no logout endpoint, no reset token table, no lookup.
//
// The email send is stubbed (no Resend in tests) but the CAPTURED calls are
// asserted, because "who was emailed, and how many times" is load-bearing
// for the multi-school case below.

interface SentEmail {
  to: string;
  subject: string;
  html: string;
}

describe("PortalAuthService — logout and password recovery", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

  const sent: SentEmail[] = [];
  const emailStub = {
    send: async (params: SentEmail) => {
      sent.push(params);
    },
  };

  const auth = new AuthService();
  const portalAuth = new PortalAuthService(emailStub as never);

  const schoolIds = new Set<string>();

  function randomPhone(): string {
    return `+234${Math.floor(700_0000000 + Math.random() * 99_9999999)}`.slice(0, 14);
  }

  /** A school with one guardian who HAS accepted a portal invitation. */
  async function makeGuardian(
    suffix: string,
    email: string,
    password = "Correct-Horse-9",
  ): Promise<{ schoolId: string; guardianId: string; schoolName: string }> {
    const schoolName = `Recovery ${suffix}`;
    const signed = await auth.signupOwner(
      {
        schoolName,
        schoolSlug: `recovery-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `recovery-owner-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);

    const guardianId = await withTenant(schoolId, async (db) => {
      const g = await db.guardian.create({
        data: {
          schoolId,
          firstName: "Gina",
          lastName: `Guardian-${suffix}`,
          relationship: "MOTHER",
          phone: randomPhone(),
          email,
          // Portal-enabled: this is what "has accepted an invitation" means
          // in the schema (Guardian.passwordHash non-null).
          passwordHash: await hash(password),
          emailVerified: true,
        },
        select: { id: true },
      });
      return g.id;
    });

    return { schoolId, guardianId, schoolName };
  }

  async function hash(plain: string): Promise<string> {
    const password = await import("../../common/auth/password");
    return password.hashPassword(plain);
  }

  /** Pull the raw token out of the reset URL the email carried. */
  function tokenFromEmail(email: SentEmail): string {
    const match = /\/reset-password\/([A-Za-z0-9_-]+)/.exec(email.html);
    if (!match) throw new Error(`no reset token in email html: ${email.html}`);
    return match[1]!;
  }

  beforeAll(() => {
    sent.length = 0;
  });

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // ───────────────────────────── logout ─────────────────────────────

  describe("logout", () => {
    it("destroys the current session so the token stops resolving", async () => {
      const email = `logout-${runId}@example.test`;
      const { schoolId, guardianId } = await makeGuardian("logout", email);

      const login = await portalAuth.login(
        guardianLoginSchema.parse({ email, password: "Correct-Horse-9" }),
        reqCtx,
      );

      const sessionId = await withTenant(schoolId, async (db) => {
        const s = await db.guardianSession.findFirst({
          where: { guardianId },
          select: { id: true },
        });
        return s!.id;
      });

      await portalAuth.logout({ sessionId, guardianId, schoolId }, reqCtx);

      // The row is gone — and because GuardianAuthGuard has no cache, that
      // IS the revocation. Assert on the DB rather than on a guard call so
      // the test does not depend on guard internals.
      const remaining = await withTenant(schoolId, (db) =>
        db.guardianSession.count({ where: { id: sessionId } }),
      );
      expect(remaining).toBe(0);
      expect(login.token).toBeTruthy();
    });

    it("signs out ONLY the current session, leaving other devices signed in", async () => {
      const email = `logout-multi-${runId}@example.test`;
      const { schoolId, guardianId } = await makeGuardian("logout-multi", email);

      // Two logins = two sessions, as if phone and school computer.
      await portalAuth.login(
        guardianLoginSchema.parse({ email, password: "Correct-Horse-9" }),
        reqCtx,
      );
      await portalAuth.login(
        guardianLoginSchema.parse({ email, password: "Correct-Horse-9" }),
        reqCtx,
      );

      const sessions = await withTenant(schoolId, (db) =>
        db.guardianSession.findMany({ where: { guardianId }, select: { id: true } }),
      );
      expect(sessions).toHaveLength(2);

      await portalAuth.logout({ sessionId: sessions[0]!.id, guardianId, schoolId }, reqCtx);

      const left = await withTenant(schoolId, (db) =>
        db.guardianSession.findMany({ where: { guardianId }, select: { id: true } }),
      );
      expect(left).toHaveLength(1);
      expect(left[0]!.id).toBe(sessions[1]!.id);
    });

    it("is idempotent — logging out twice does not throw", async () => {
      const email = `logout-twice-${runId}@example.test`;
      const { schoolId, guardianId } = await makeGuardian("logout-twice", email);
      await portalAuth.login(
        guardianLoginSchema.parse({ email, password: "Correct-Horse-9" }),
        reqCtx,
      );
      const s = await withTenant(schoolId, (db) =>
        db.guardianSession.findFirstOrThrow({ where: { guardianId }, select: { id: true } }),
      );

      await portalAuth.logout({ sessionId: s.id, guardianId, schoolId }, reqCtx);
      await expect(
        portalAuth.logout({ sessionId: s.id, guardianId, schoolId }, reqCtx),
      ).resolves.toBeUndefined();
    });

    it("writes an audit row naming the guardian and the session", async () => {
      const email = `logout-audit-${runId}@example.test`;
      const { schoolId, guardianId } = await makeGuardian("logout-audit", email);
      await portalAuth.login(
        guardianLoginSchema.parse({ email, password: "Correct-Horse-9" }),
        reqCtx,
      );
      const s = await withTenant(schoolId, (db) =>
        db.guardianSession.findFirstOrThrow({ where: { guardianId }, select: { id: true } }),
      );
      await portalAuth.logout({ sessionId: s.id, guardianId, schoolId }, reqCtx);

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "guardian.logout", entityId: s.id },
          select: { userId: true, entityType: true },
        }),
      );
      expect(audit).not.toBeNull();
      expect(audit!.userId).toBe(guardianId);
      expect(audit!.entityType).toBe("guardian-session");
    });
  });

  // ────────────────────────── forgot password ──────────────────────────

  describe("forgotPassword — account enumeration", () => {
    it("returns the SAME response for a real account and an unknown email", async () => {
      const email = `forgot-real-${runId}@example.test`;
      await makeGuardian("forgot-real", email);

      const real = await portalAuth.forgotPassword(
        guardianForgotPasswordSchema.parse({ email }),
        reqCtx,
      );
      const unknown = await portalAuth.forgotPassword(
        guardianForgotPasswordSchema.parse({
          email: `nobody-${runId}@example.test`,
        }),
        reqCtx,
      );

      // Byte-identical. This is the enumeration guard.
      expect(real).toEqual(unknown);
      expect(real.message).toContain("If an account exists");
    });

    it("issues NO token and sends NO email for an unknown email", async () => {
      // Counted inside the tenant: guardian_password_reset_tokens is under
      // FORCE RLS, so a basePrisma count would read 0 whatever happened and
      // the assertion would pass for the wrong reason.
      const email = `ghost-${runId}@example.test`;
      const { schoolId } = await makeGuardian("ghost-neighbour", `neighbour-${runId}@example.test`);

      const before = await withTenant(schoolId, (db) =>
        db.guardianPasswordResetToken.count(),
      );
      const sentBefore = sent.length;

      await portalAuth.forgotPassword(
        guardianForgotPasswordSchema.parse({ email }),
        reqCtx,
      );

      expect(
        await withTenant(schoolId, (db) => db.guardianPasswordResetToken.count()),
      ).toBe(before);
      expect(sent.length).toBe(sentBefore);
    });

    it("issues NO token for a guardian who never accepted an invitation", async () => {
      // The guardian row exists and has an email, but password_hash is NULL.
      // Recovery must not become a way to set a first password — that would
      // bypass the invitation flow entirely.
      const email = `never-invited-${runId}@example.test`;
      const signed = await auth.signupOwner(
        {
          schoolName: "Never Invited",
          schoolSlug: `never-invited-${runId}`,
          ownerFirstName: "Owen",
          ownerLastName: "Owner",
          ownerEmail: `ni-owner-${runId}@example.test`,
          ownerPhone: randomPhone(),
          password: "Correct-Horse-9",
          ndprConsent: true,
        },
        reqCtx,
      );
      schoolIds.add(signed.school.id);
      await withTenant(signed.school.id, (db) =>
        db.guardian.create({
          data: {
            schoolId: signed.school.id,
            firstName: "Nev",
            lastName: "Invited",
            relationship: "FATHER",
            phone: randomPhone(),
            email,
          },
        }),
      );

      const sentBefore = sent.length;
      const res = await portalAuth.forgotPassword(
        guardianForgotPasswordSchema.parse({ email }),
        reqCtx,
      );

      expect(res.message).toContain("If an account exists");
      expect(
        await withTenant(signed.school.id, (db) =>
          db.guardianPasswordResetToken.count(),
        ),
      ).toBe(0);
      expect(sent.length).toBe(sentBefore); // and no email either
    });

    it("issues one token and one email PER SCHOOL when the address has accounts at several", async () => {
      // Guardian.email is unique only per school (Decision C), so this is a
      // legitimate state, not a data error. Login resolves it by verifying
      // the password against each candidate; recovery has no secret to
      // resolve it with, so it must serve every account rather than guess.
      const email = `multi-${runId}@example.test`;
      const a = await makeGuardian("multi-a", email);
      const b = await makeGuardian("multi-b", email);

      const sentBefore = sent.length;
      await portalAuth.forgotPassword(
        guardianForgotPasswordSchema.parse({ email }),
        reqCtx,
      );

      const issued = sent.slice(sentBefore);
      expect(issued).toHaveLength(2);
      // Each email names ITS school, so the recipient can tell them apart.
      const subjects = issued.map((e) => e.subject).sort();
      expect(subjects[0]).toContain(a.schoolName);
      expect(subjects[1]).toContain(b.schoolName);

      // One token in EACH tenant. Read through withTenant, because the
      // table is under FORCE RLS and basePrisma would see neither.
      expect(
        await withTenant(a.schoolId, (db) => db.guardianPasswordResetToken.count()),
      ).toBe(1);
      expect(
        await withTenant(b.schoolId, (db) => db.guardianPasswordResetToken.count()),
      ).toBe(1);
    });

    it("stores only a HASH of the token, never the token itself", async () => {
      const email = `hash-${runId}@example.test`;
      const { schoolId } = await makeGuardian("hash", email);
      const sentBefore = sent.length;
      await portalAuth.forgotPassword(
        guardianForgotPasswordSchema.parse({ email }),
        reqCtx,
      );
      const rawToken = tokenFromEmail(sent[sentBefore]!);

      const row = await withTenant(schoolId, (db) =>
        db.guardianPasswordResetToken.findFirstOrThrow({
          where: { schoolId },
          select: { tokenHash: true, expiresAt: true, usedAt: true },
        }),
      );

      expect(row.tokenHash).not.toBe(rawToken);
      expect(row.tokenHash).toHaveLength(64); // sha256 hex
      expect(row.usedAt).toBeNull();
      // TTL is one hour; allow a generous window for slow CI.
      const ttlMs = row.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(50 * 60 * 1000);
      expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000);
    });
  });

  // ────────────────────────── reset password ──────────────────────────

  describe("resetPassword", () => {
    async function requestReset(suffix: string) {
      const email = `reset-${suffix}-${runId}@example.test`;
      const made = await makeGuardian(suffix, email);
      const before = sent.length;
      await portalAuth.forgotPassword(
        guardianForgotPasswordSchema.parse({ email }),
        reqCtx,
      );
      return { ...made, email, rawToken: tokenFromEmail(sent[before]!) };
    }

    it("sets the new password so the guardian can sign in with it", async () => {
      const { email, rawToken } = await requestReset("happy");

      await portalAuth.resetPassword(
        guardianResetPasswordSchema.parse({ token: rawToken, password: "Brand-New-Pass-1!" }),
        reqCtx,
      );

      const login = await portalAuth.login(
        guardianLoginSchema.parse({ email, password: "Brand-New-Pass-1!" }),
        reqCtx,
      );
      expect(login.token).toBeTruthy();
      expect(login.guardian.email).toBe(email);
    });

    it("makes the OLD password stop working", async () => {
      const { email, rawToken } = await requestReset("old-dead");
      await portalAuth.resetPassword(
        guardianResetPasswordSchema.parse({ token: rawToken, password: "Brand-New-Pass-1!" }),
        reqCtx,
      );

      await expect(
        portalAuth.login(
          guardianLoginSchema.parse({ email, password: "Correct-Horse-9" }),
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("kills EVERY existing session — a reset signs you out everywhere", async () => {
      const { email, schoolId, guardianId, rawToken } = await requestReset("kill-sessions");
      await portalAuth.login(
        guardianLoginSchema.parse({ email, password: "Correct-Horse-9" }),
        reqCtx,
      );
      await portalAuth.login(
        guardianLoginSchema.parse({ email, password: "Correct-Horse-9" }),
        reqCtx,
      );
      expect(
        await withTenant(schoolId, (db) =>
          db.guardianSession.count({ where: { guardianId } }),
        ),
      ).toBe(2);

      await portalAuth.resetPassword(
        guardianResetPasswordSchema.parse({ token: rawToken, password: "Brand-New-Pass-1!" }),
        reqCtx,
      );

      expect(
        await withTenant(schoolId, (db) =>
          db.guardianSession.count({ where: { guardianId } }),
        ),
      ).toBe(0);
    });

    it("is SINGLE USE — the same token cannot be replayed", async () => {
      const { rawToken } = await requestReset("single-use");

      await portalAuth.resetPassword(
        guardianResetPasswordSchema.parse({ token: rawToken, password: "Brand-New-Pass-1!" }),
        reqCtx,
      );

      await expect(
        portalAuth.resetPassword(
          guardianResetPasswordSchema.parse({
            token: rawToken,
            password: "Different-Pass-2!",
          }),
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "PASSWORD_RESET_ALREADY_USED" });
    });

    it("burns OTHER outstanding tokens, so an older emailed link cannot be replayed", async () => {
      const email = `reset-burn-${runId}@example.test`;
      const { schoolId } = await makeGuardian("burn", email);

      const first = sent.length;
      await portalAuth.forgotPassword(guardianForgotPasswordSchema.parse({ email }), reqCtx);
      const olderToken = tokenFromEmail(sent[first]!);

      const second = sent.length;
      await portalAuth.forgotPassword(guardianForgotPasswordSchema.parse({ email }), reqCtx);
      const newerToken = tokenFromEmail(sent[second]!);
      expect(newerToken).not.toBe(olderToken);

      // Use the NEWER one.
      await portalAuth.resetPassword(
        guardianResetPasswordSchema.parse({ token: newerToken, password: "Brand-New-Pass-1!" }),
        reqCtx,
      );

      // The older link, still sitting in the inbox, is now dead.
      await expect(
        portalAuth.resetPassword(
          guardianResetPasswordSchema.parse({
            token: olderToken,
            password: "Attacker-Pass-3!",
          }),
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "PASSWORD_RESET_ALREADY_USED" });

      expect(
        await withTenant(schoolId, (db) =>
          db.guardianPasswordResetToken.count({ where: { usedAt: null } }),
        ),
      ).toBe(0);
    });

    it("rejects an EXPIRED token with a distinct, actionable code", async () => {
      const { schoolId, rawToken } = await requestReset("expired");
      await withTenant(schoolId, (db) =>
        db.guardianPasswordResetToken.updateMany({
          where: { schoolId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );

      await expect(
        portalAuth.resetPassword(
          guardianResetPasswordSchema.parse({ token: rawToken, password: "Brand-New-Pass-1!" }),
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "PASSWORD_RESET_EXPIRED" });
    });

    it("reports ALREADY_USED ahead of EXPIRED when a token is both", async () => {
      // A guardian who used the link, then came back after it would also
      // have expired, gets the more useful of the two messages.
      const { schoolId, rawToken } = await requestReset("used-and-expired");
      await portalAuth.resetPassword(
        guardianResetPasswordSchema.parse({ token: rawToken, password: "Brand-New-Pass-1!" }),
        reqCtx,
      );
      await withTenant(schoolId, (db) =>
        db.guardianPasswordResetToken.updateMany({
          where: { schoolId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );

      await expect(
        portalAuth.resetPassword(
          guardianResetPasswordSchema.parse({ token: rawToken, password: "Another-Pass-4!" }),
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "PASSWORD_RESET_ALREADY_USED" });
    });

    it("rejects a garbage token as not found, without saying anything else", async () => {
      await expect(
        portalAuth.resetPassword(
          guardianResetPasswordSchema.parse({
            token: "definitely-not-a-real-token",
            password: "Brand-New-Pass-1!",
          }),
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("does NOT accept a STAFF reset token — cross-principal confusion is structurally impossible", async () => {
      // This is the security property that justified a parallel table rather
      // than reusing password_reset_tokens. The guardian resolver reads only
      // guardian_password_reset_tokens, so a perfectly valid staff token
      // resolves to nothing here.
      const staffEmail = `staff-cross-${runId}@example.test`;
      const signed = await auth.signupOwner(
        {
          schoolName: "Cross Principal",
          schoolSlug: `cross-principal-${runId}`,
          ownerFirstName: "Stan",
          ownerLastName: "Staff",
          ownerEmail: staffEmail,
          ownerPhone: randomPhone(),
          password: "Correct-Horse-9",
          ndprConsent: true,
        },
        reqCtx,
      );
      schoolIds.add(signed.school.id);

      // Mint a REAL staff reset token through the staff service.
      const staffAuth = new AuthService(
        { send: async () => undefined } as never,
      );
      await staffAuth.forgotPassword({ email: staffEmail }, reqCtx);
      const staffToken = await withTenant(signed.school.id, (db) =>
        db.passwordResetToken.findFirstOrThrow({
          where: { schoolId: signed.school.id },
          select: { tokenHash: true },
        }),
      );
      expect(staffToken.tokenHash).toBeTruthy(); // a real, live staff token exists

      // Now the real proof. Take the raw staff reset token straight from the
      // staff service's own log-free path: we cannot recover it from the
      // hash, so instead assert the property at the resolver level — the
      // guardian resolver is asked for the staff token's hash and returns
      // NOTHING, because it reads a different table.
      const resolved = await basePrisma.$queryRaw<unknown[]>`
        SELECT * FROM auth_resolve_guardian_password_reset_token(${staffToken.tokenHash})
      `;
      expect(resolved).toHaveLength(0);

      // And the converse sanity check, so the assertion above cannot pass
      // merely because the resolver is broken: a genuine GUARDIAN token
      // hash DOES resolve through it.
      const gEmail = `cross-guardian-${runId}@example.test`;
      const g = await makeGuardian("cross-guardian", gEmail);
      await portalAuth.forgotPassword(
        guardianForgotPasswordSchema.parse({ email: gEmail }),
        reqCtx,
      );
      const guardianHash = await withTenant(g.schoolId, (db) =>
        db.guardianPasswordResetToken.findFirstOrThrow({ select: { tokenHash: true } }),
      );
      const guardianResolved = await basePrisma.$queryRaw<unknown[]>`
        SELECT * FROM auth_resolve_guardian_password_reset_token(${guardianHash.tokenHash})
      `;
      expect(guardianResolved).toHaveLength(1);
    });

    it("writes an audit row on a completed reset", async () => {
      const { schoolId, guardianId, rawToken } = await requestReset("audit");
      await portalAuth.resetPassword(
        guardianResetPasswordSchema.parse({ token: rawToken, password: "Brand-New-Pass-1!" }),
        reqCtx,
      );

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "guardian.password-reset.completed", entityId: guardianId },
          select: { userId: true },
        }),
      );
      expect(audit).not.toBeNull();
      expect(audit!.userId).toBe(guardianId);
    });
  });

  // ─────────────────────────── tenant isolation ───────────────────────────

  describe("tenant isolation", () => {
    it("does not expose one school's reset tokens to another school's tenant", async () => {
      const email = `iso-${runId}@example.test`;
      const a = await makeGuardian("iso-a", email);
      const b = await makeGuardian("iso-b", `iso-other-${runId}@example.test`);

      await portalAuth.forgotPassword(
        guardianForgotPasswordSchema.parse({ email }),
        reqCtx,
      );

      const seenFromA = await withTenant(a.schoolId, (db) =>
        db.guardianPasswordResetToken.count(),
      );
      const seenFromB = await withTenant(b.schoolId, (db) =>
        db.guardianPasswordResetToken.count(),
      );

      expect(seenFromA).toBe(1);
      expect(seenFromB).toBe(0); // RLS, not a WHERE clause in the query above
    });
  });
});
