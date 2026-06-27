import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { UnauthorizedError, loginSchema, signupOwnerSchema } from "@school-kit/types";

import * as password from "../../common/auth/password";
import { AuthService } from "./auth.service";

// Integration spec — real Postgres, same style as auth.service.spec.ts.
// Login is the most-attacked endpoint we ship; the assertions below pin
// the security-critical invariants (no enumeration, generic errors, audit
// log, redacted PII, password hash never returned).

describe("AuthService.login (Phase 0 Prompt 4)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const service = new AuthService();
  const ctx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

  const schoolIdsToCleanup = new Set<string>();
  let testSchoolId: string;
  let testUserId: string;
  const testEmail = `login-${runId}@example.test`;
  const testPassword = "Correct-Horse-9";

  beforeAll(async () => {
    // Use signupOwner to bootstrap a school + owner — keeps the test
    // honest about the integration between signup and login.
    const input = signupOwnerSchema.parse({
      schoolName: "Login Academy",
      schoolSlug: `login-${runId}`,
      ownerFirstName: "Lin",
      ownerLastName: "Owner",
      ownerEmail: testEmail,
      ownerPhone: `+234805${phoneSuffix}`,
      password: testPassword,
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

  it("happy path — returns { user, school, token }, updates lastLoginAt, writes audit row, no password leakage", async () => {
    const before = Date.now();
    const input = loginSchema.parse({ email: testEmail, password: testPassword });
    const result = await service.login(input, ctx);
    if (result.requiresTwoFactor) throw new Error("Expected a session, not a 2FA challenge");

    expect(result.user.id).toBe(testUserId);
    expect(result.user.schoolId).toBe(testSchoolId);
    expect(result.school.id).toBe(testSchoolId);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    // Public response must NOT carry the hash.
    expect((result.user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    // Token must not be the plaintext password.
    expect(result.token).not.toBe(testPassword);

    await withTenant(testSchoolId, async (db) => {
      const user = await db.user.findUnique({ where: { id: testUserId } });
      expect(user?.lastLoginAt).toBeInstanceOf(Date);
      expect(user!.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before);

      // A NEW session row exists (signup made one too; login makes a second).
      const sessions = await db.session.findMany({ where: { userId: testUserId } });
      expect(sessions.length).toBeGreaterThanOrEqual(2);

      const auditRows = await db.auditLog.findMany({
        where: { schoolId: testSchoolId, action: "auth.login", userId: testUserId },
      });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      const meta = auditRows[0]!.metadata as Record<string, unknown>;
      expect(meta.ownerEmail).not.toBe(testEmail);
      expect(String(meta.ownerEmail)).toContain("***");
      // Password must NEVER appear in the audit metadata.
      expect(JSON.stringify(meta)).not.toContain(testPassword);
    });
  });

  it("wrong password — UnauthorizedError INVALID_CREDENTIALS; no new session, no audit row", async () => {
    const sessionsBefore = await withTenant(testSchoolId, (db) =>
      db.session.count({ where: { userId: testUserId } }),
    );
    const auditBefore = await withTenant(testSchoolId, (db) =>
      db.auditLog.count({ where: { schoolId: testSchoolId, action: "auth.login" } }),
    );

    const input = loginSchema.parse({ email: testEmail, password: "Wrong-Password-1" });
    await expect(service.login(input, ctx)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await expect(service.login(input, ctx)).rejects.toBeInstanceOf(UnauthorizedError);

    const sessionsAfter = await withTenant(testSchoolId, (db) =>
      db.session.count({ where: { userId: testUserId } }),
    );
    const auditAfter = await withTenant(testSchoolId, (db) =>
      db.auditLog.count({ where: { schoolId: testSchoolId, action: "auth.login" } }),
    );
    expect(sessionsAfter).toBe(sessionsBefore);
    expect(auditAfter).toBe(auditBefore);
  });

  it("unknown email — UnauthorizedError INVALID_CREDENTIALS AND verifyPassword ran on a dummy hash (timing-safe)", async () => {
    // Spy on the password module's verifyPassword so we can prove the dummy
    // verify path runs even when there is no user row. Without this
    // assertion, the timing-safe behaviour can regress silently.
    //
    // We spy on apps/api/src/common/auth/password.ts (which the service
    // imports as `password.verifyPassword`) rather than argon2 directly,
    // because argon2 ships as CJS with non-configurable exports — vi.spyOn
    // on argon2.verify throws "Cannot redefine property".
    const verifySpy = vi.spyOn(password, "verifyPassword");
    try {
      const input = loginSchema.parse({
        email: `nobody-${runId}@example.test`,
        password: "Whatever-Password-1",
      });
      await expect(service.login(input, ctx)).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
      // The dummy-verify call against a real argon2id hash must have run.
      expect(verifySpy).toHaveBeenCalled();
      const [hash] = verifySpy.mock.calls[0]!;
      expect(typeof hash).toBe("string");
      expect(String(hash).startsWith("$argon2")).toBe(true);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it("inactive user — UnauthorizedError INVALID_CREDENTIALS (same code; no account-state leak)", async () => {
    // Deactivate the test user. withTenant required — users is under RLS.
    await withTenant(testSchoolId, (db) =>
      db.user.update({ where: { id: testUserId }, data: { isActive: false } }),
    );
    try {
      const input = loginSchema.parse({ email: testEmail, password: testPassword });
      await expect(service.login(input, ctx)).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    } finally {
      await withTenant(testSchoolId, (db) =>
        db.user.update({ where: { id: testUserId }, data: { isActive: true } }),
      );
    }
  });

  it("empty password — Zod schema rejects (ValidationError surfaced by the pipe)", () => {
    const parsed = loginSchema.safeParse({ email: testEmail, password: "" });
    expect(parsed.success).toBe(false);
  });

  it("email is case-insensitive at the boundary (Zod lowercases)", async () => {
    const input = loginSchema.parse({ email: testEmail.toUpperCase(), password: testPassword });
    const result = await service.login(input, ctx);
    if (result.requiresTwoFactor) throw new Error("Expected a session, not a 2FA challenge");
    expect(result.user.id).toBe(testUserId);
  });
});
