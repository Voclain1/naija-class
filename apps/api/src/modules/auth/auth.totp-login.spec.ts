import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { loginSchema, signupOwnerSchema, totpChallengeSchema } from "@school-kit/types";
import { generateSync } from "otplib";
import Redis from "ioredis";

import { AuthService } from "./auth.service";
import { TotpService } from "./totp.service";

// Integration spec — real Postgres + real Redis.
// Covers the 2FA-gated login flow introduced in Phase 3 Slice 2 CP2:
//   POST /auth/login  → { requiresTwoFactor: true, challengeToken }  (when 2FA on)
//   POST /auth/2fa/challenge → { requiresTwoFactor: false, user, school, token }
//
// Test isolation: each describe creates its own school + owner + Redis client,
// torn down in afterAll. The Redis client is quit (not disconnect) so pending
// commands flush before the connection closes.

describe("AuthService — 2FA login flow (Phase 3 Slice 2 CP2)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");

  const redisClient = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const totpSvc = new TotpService();
  const svc = new AuthService(totpSvc, redisClient);
  const ctx = { ipAddress: "127.0.0.1", userAgent: "vitest-totp" };

  let schoolId: string;
  let userId: string;
  let totpSecret: string;
  const testEmail = `totp-${runId}@example.test`;
  const testPassword = "Correct-Horse-9";

  beforeAll(async () => {
    // 1. Sign up the school + owner.
    const signupInput = signupOwnerSchema.parse({
      schoolName: "TOTP Test Academy",
      schoolSlug: `totp-${runId}`,
      ownerFirstName: "Tfa",
      ownerLastName: "Owner",
      ownerEmail: testEmail,
      ownerPhone: `+234806${phoneSuffix}`,
      password: testPassword,
      ndprConsent: true as const,
    });
    const signup = await svc.signupOwner(signupInput, ctx);
    schoolId = signup.school.id;
    userId = signup.user.id;

    // 2. Set up + confirm 2FA so totp_enabled = true in the DB.
    const setup = await svc.setupTwoFactor(userId, schoolId);
    totpSecret = setup.secret;
    const confirmCode = generateSync({ secret: totpSecret });
    await svc.confirmTwoFactor(userId, schoolId, { code: confirmCode });
  });

  afterAll(async () => {
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    await basePrisma.$disconnect();
    await redisClient.quit();
  });

  // --- login() 2FA branch ---

  it("login with 2FA enabled returns { requiresTwoFactor: true, challengeToken } and issues no session", async () => {
    const sessionsBefore = await withTenant(schoolId, (db) =>
      db.session.count({ where: { userId } }),
    );

    const input = loginSchema.parse({ email: testEmail, password: testPassword });
    const result = await svc.login(input, ctx);

    expect(result.requiresTwoFactor).toBe(true);
    if (!result.requiresTwoFactor) throw new Error("Expected 2FA challenge");
    expect(typeof result.challengeToken).toBe("string");
    expect(result.challengeToken.length).toBeGreaterThan(20);
    // No new session — the challenge token is NOT a bearer token.
    expect(result).not.toHaveProperty("token");

    const sessionsAfter = await withTenant(schoolId, (db) =>
      db.session.count({ where: { userId } }),
    );
    expect(sessionsAfter).toBe(sessionsBefore);
  });

  // --- loginWithChallenge() happy path ---

  it("correct TOTP code + valid challenge token → full session (requiresTwoFactor: false)", async () => {
    // Get a fresh challenge token.
    const loginInput = loginSchema.parse({ email: testEmail, password: testPassword });
    const loginResult = await svc.login(loginInput, ctx);
    if (!loginResult.requiresTwoFactor) throw new Error("Expected 2FA challenge");
    const { challengeToken } = loginResult;

    const code = generateSync({ secret: totpSecret });
    const challengeInput = totpChallengeSchema.parse({ challengeToken, code });
    const challengeResult = await svc.loginWithChallenge(challengeInput, ctx);

    expect(challengeResult.requiresTwoFactor).toBe(false);
    if (challengeResult.requiresTwoFactor) throw new Error("Expected session");
    expect(challengeResult.user.id).toBe(userId);
    expect(challengeResult.user.schoolId).toBe(schoolId);
    expect(challengeResult.school.id).toBe(schoolId);
    expect(challengeResult.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    // A session row must exist.
    const sessions = await withTenant(schoolId, (db) =>
      db.session.findMany({ where: { userId } }),
    );
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    // Audit log must carry auth.login_2fa.
    const auditRows = await withTenant(schoolId, (db) =>
      db.auditLog.findMany({
        where: { schoolId, action: "auth.login_2fa", userId },
      }),
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it("wrong TOTP code → UnauthorizedError INVALID_2FA_CODE", async () => {
    const loginInput = loginSchema.parse({ email: testEmail, password: testPassword });
    const loginResult = await svc.login(loginInput, ctx);
    if (!loginResult.requiresTwoFactor) throw new Error("Expected 2FA challenge");

    const challengeInput = totpChallengeSchema.parse({
      challengeToken: loginResult.challengeToken,
      code: "000000",
    });
    await expect(svc.loginWithChallenge(challengeInput, ctx)).rejects.toMatchObject({
      code: "INVALID_2FA_CODE",
    });
  });

  it("missing / expired challenge token → UnauthorizedError INVALID_2FA_CHALLENGE", async () => {
    const challengeInput = totpChallengeSchema.parse({
      challengeToken: "nonexistent-token-that-was-never-issued",
      code: "000000",
    });
    await expect(svc.loginWithChallenge(challengeInput, ctx)).rejects.toMatchObject({
      code: "INVALID_2FA_CHALLENGE",
    });
  });

  it("wrong code does not consume the challenge token — correct code on the same token succeeds", async () => {
    const loginInput = loginSchema.parse({ email: testEmail, password: testPassword });
    const loginResult = await svc.login(loginInput, ctx);
    if (!loginResult.requiresTwoFactor) throw new Error("Expected 2FA challenge");
    const { challengeToken } = loginResult;

    // First attempt: wrong code. Must throw INVALID_2FA_CODE, not consume the token.
    await expect(
      svc.loginWithChallenge(totpChallengeSchema.parse({ challengeToken, code: "000000" }), ctx),
    ).rejects.toMatchObject({ code: "INVALID_2FA_CODE" });

    // Second attempt: same challenge token, correct code. Must succeed.
    const correctCode = generateSync({ secret: totpSecret });
    const retryResult = await svc.loginWithChallenge(
      totpChallengeSchema.parse({ challengeToken, code: correctCode }),
      ctx,
    );
    expect(retryResult.requiresTwoFactor).toBe(false);
    if (retryResult.requiresTwoFactor) throw new Error("Expected session on retry");
    expect(retryResult.user.id).toBe(userId);
    expect(typeof retryResult.token).toBe("string");
  });

  it("single-use: a second call with the same challenge token → INVALID_2FA_CHALLENGE", async () => {
    // Obtain a fresh challenge token.
    const loginInput = loginSchema.parse({ email: testEmail, password: testPassword });
    const loginResult = await svc.login(loginInput, ctx);
    if (!loginResult.requiresTwoFactor) throw new Error("Expected 2FA challenge");
    const { challengeToken } = loginResult;

    const code = generateSync({ secret: totpSecret });

    // First call — must succeed.
    const first = totpChallengeSchema.parse({ challengeToken, code });
    await svc.loginWithChallenge(first, ctx);

    // Second call with the SAME token — token was consumed, must 401.
    const second = totpChallengeSchema.parse({ challengeToken, code });
    await expect(svc.loginWithChallenge(second, ctx)).rejects.toMatchObject({
      code: "INVALID_2FA_CHALLENGE",
    });
  });
});
