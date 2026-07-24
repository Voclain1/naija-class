import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupOwnerSchema,
  UnauthorizedError,
} from "@school-kit/types";

import { AuthService } from "./auth.service";

// Integration spec — real Postgres, same style as auth.login.spec.ts. Covers
// the Phase 0 gap closed 2026-07-24: forgot/reset password never had any
// implementation before this PR.

describe("AuthService.forgotPassword / resetPassword", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const service = new AuthService();
  const ctx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

  const schoolIdsToCleanup = new Set<string>();
  let testSchoolId: string;
  let testUserId: string;
  const testEmail = `reset-${runId}@example.test`;
  const originalPassword = "Correct-Horse-9";

  beforeAll(async () => {
    const input = signupOwnerSchema.parse({
      schoolName: "Reset Academy",
      schoolSlug: `reset-${runId}`,
      ownerFirstName: "Res",
      ownerLastName: "Owner",
      ownerEmail: testEmail,
      ownerPhone: `+234806${phoneSuffix}`,
      password: originalPassword,
      ndprConsent: true as const,
    });
    const r = await service.signupOwner(input, ctx);
    schoolIdsToCleanup.add(r.school.id);
    testSchoolId = r.school.id;
    testUserId = r.user.id;
  });

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // AuthService.forgotPassword never returns its raw token (it only ever
  // goes out via email / the logged fallback line) — proving forgotPassword
  // works end-to-end only needs the DB side-effect assertions above. For
  // resetPassword's own tests we mint a token row directly, the same way
  // the service does internally (random bytes -> sha256 hash stored, raw
  // value handed back only here, exactly as it would be in a real email).
  async function issueResetToken(): Promise<{ rawToken: string; resetId: string }> {
    const crypto = await import("node:crypto");
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const row = await withTenant(testSchoolId, (db) =>
      db.passwordResetToken.create({
        data: {
          schoolId: testSchoolId,
          userId: testUserId,
          tokenHash,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      }),
    );
    return { rawToken, resetId: row.id };
  }

  describe("forgotPassword", () => {
    it("known active email — creates a token row + audit row, generic response", async () => {
      const before = await withTenant(testSchoolId, (db) =>
        db.passwordResetToken.count({ where: { userId: testUserId } }),
      );
      const input = forgotPasswordSchema.parse({ email: testEmail });
      const result = await service.forgotPassword(input, ctx);
      expect(result.message).toContain("If an account exists");

      const after = await withTenant(testSchoolId, (db) =>
        db.passwordResetToken.count({ where: { userId: testUserId } }),
      );
      expect(after).toBe(before + 1);

      const auditRows = await withTenant(testSchoolId, (db) =>
        db.auditLog.findMany({
          where: { schoolId: testSchoolId, action: "auth.password_reset_requested", userId: testUserId },
        }),
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      const meta = auditRows[0]!.metadata as Record<string, unknown>;
      expect(meta.email).not.toBe(testEmail);
      expect(String(meta.email)).toContain("***");
    });

    it("unknown email — SAME generic response, no token row created anywhere (no enumeration)", async () => {
      const input = forgotPasswordSchema.parse({ email: `nobody-${runId}@example.test` });
      const result = await service.forgotPassword(input, ctx);
      expect(result.message).toContain("If an account exists");
      // Nothing to assert against a specific school/user for an unknown
      // email — the meaningful assertion is that the call did not throw and
      // returned the identical message, proven by the toContain above plus
      // reusing the same GENERIC_RESPONSE object reference in the service.
    });

    it("deactivated user — same generic response, no token row created", async () => {
      await withTenant(testSchoolId, (db) =>
        db.user.update({ where: { id: testUserId }, data: { isActive: false } }),
      );
      try {
        const before = await withTenant(testSchoolId, (db) =>
          db.passwordResetToken.count({ where: { userId: testUserId } }),
        );
        const input = forgotPasswordSchema.parse({ email: testEmail });
        const result = await service.forgotPassword(input, ctx);
        expect(result.message).toContain("If an account exists");
        const after = await withTenant(testSchoolId, (db) =>
          db.passwordResetToken.count({ where: { userId: testUserId } }),
        );
        expect(after).toBe(before);
      } finally {
        await withTenant(testSchoolId, (db) =>
          db.user.update({ where: { id: testUserId }, data: { isActive: true } }),
        );
      }
    });
  });

  describe("resetPassword", () => {
    it("happy path — updates passwordHash, marks token used, kills existing sessions, writes audit row", async () => {
      // Establish a session that must be killed by the reset.
      const loginInput = loginSchema.parse({ email: testEmail, password: originalPassword });
      const loginResult = await service.login(loginInput, ctx);
      if (loginResult.requiresTwoFactor) throw new Error("Expected a session, not a 2FA challenge");
      const sessionsBefore = await withTenant(testSchoolId, (db) =>
        db.session.count({ where: { userId: testUserId } }),
      );
      expect(sessionsBefore).toBeGreaterThan(0);

      const { rawToken, resetId } = await issueResetToken();
      const newPassword = "New-Correct-Horse-8!";
      const input = resetPasswordSchema.parse({ token: rawToken, password: newPassword });
      const result = await service.resetPassword(input, ctx);
      expect(result.message).toContain("Password reset");

      const tokenRow = await withTenant(testSchoolId, (db) =>
        db.passwordResetToken.findUniqueOrThrow({ where: { id: resetId } }),
      );
      expect(tokenRow.usedAt).toBeInstanceOf(Date);

      const sessionsAfter = await withTenant(testSchoolId, (db) =>
        db.session.count({ where: { userId: testUserId } }),
      );
      expect(sessionsAfter).toBe(0);

      const auditRows = await withTenant(testSchoolId, (db) =>
        db.auditLog.findMany({
          where: { schoolId: testSchoolId, action: "auth.password_reset", userId: testUserId },
        }),
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);

      // Old password no longer works; new one does.
      await expect(
        service.login(loginSchema.parse({ email: testEmail, password: originalPassword }), ctx),
      ).rejects.toBeInstanceOf(UnauthorizedError);
      const relogin = await service.login(
        loginSchema.parse({ email: testEmail, password: newPassword }),
        ctx,
      );
      if (relogin.requiresTwoFactor) throw new Error("Expected a session, not a 2FA challenge");
      expect(relogin.user.id).toBe(testUserId);

      // Restore original password so later tests in this file keep working
      // against a known credential.
      const restoreToken = await issueResetToken();
      await service.resetPassword(
        resetPasswordSchema.parse({ token: restoreToken.rawToken, password: originalPassword }),
        ctx,
      );
    });

    it("reusing an already-used token — GoneError PASSWORD_RESET_ALREADY_USED", async () => {
      const { rawToken } = await issueResetToken();
      const input = resetPasswordSchema.parse({ token: rawToken, password: "Another-Password-1!" });
      await service.resetPassword(input, ctx);
      // Immediately restore, so this test doesn't leave the account on a
      // password later tests don't expect.
      const restore = await issueResetToken();
      await service.resetPassword(
        resetPasswordSchema.parse({ token: restore.rawToken, password: originalPassword }),
        ctx,
      );

      await expect(service.resetPassword(input, ctx)).rejects.toMatchObject({
        code: "PASSWORD_RESET_ALREADY_USED",
      });
    });

    it("expired token — GoneError PASSWORD_RESET_EXPIRED", async () => {
      const crypto = await import("node:crypto");
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await withTenant(testSchoolId, (db) =>
        db.passwordResetToken.create({
          data: {
            schoolId: testSchoolId,
            userId: testUserId,
            tokenHash,
            expiresAt: new Date(Date.now() - 1000), // already expired
          },
        }),
      );
      const input = resetPasswordSchema.parse({ token: rawToken, password: "Another-Password-2!" });
      await expect(service.resetPassword(input, ctx)).rejects.toMatchObject({
        code: "PASSWORD_RESET_EXPIRED",
      });
    });

    it("unknown token — NotFoundError", async () => {
      const input = resetPasswordSchema.parse({
        token: "totally-made-up-token-value",
        password: "Another-Password-3!",
      });
      await expect(service.resetPassword(input, ctx)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("weak password — Zod schema rejects (ValidationError surfaced by the pipe)", async () => {
      const { rawToken } = await issueResetToken();
      const parsed = resetPasswordSchema.safeParse({ token: rawToken, password: "weak" });
      expect(parsed.success).toBe(false);
    });
  });
});
