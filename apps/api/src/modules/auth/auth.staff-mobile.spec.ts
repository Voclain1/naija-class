import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { generateSync } from "otplib";

import { basePrisma, withTenant } from "@school-kit/db";
import { staffMobileChallengeSchema, staffMobileLoginSchema, signupOwnerSchema } from "@school-kit/types";
import { AuthService } from "./auth.service";
import { TotpService } from "./totp.service";
import { getCachedSession, setCachedSession } from "../../common/auth/session-cache";

describe("staff mobile auth foundation (real Postgres + Redis)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const totp = new TotpService();
  const service = new AuthService(totp, redis);
  const ctx = { ipAddress: "127.0.0.1", userAgent: "CP1-real-device-contract" };
  const password = "Correct-Horse-9";
  const device = { deviceId: `install-${runId}-123456789`, deviceName: "Pixel CP1" };
  let enabledSchoolId: string;
  let enabledUserId: string;
  let disabledSchoolId: string;
  let disabledUserId: string;
  let secret: string;

  beforeAll(async () => {
    const enabled = await service.signupOwner(signupOwnerSchema.parse({
      schoolName: "Staff Mobile Pilot", schoolSlug: `staff-mobile-${runId}`,
      ownerFirstName: "Mobile", ownerLastName: "Owner",
      ownerEmail: `mobile-${runId}@example.test`, ownerPhone: `+234801${Date.now().toString().slice(-6)}`,
      password, ndprConsent: true,
    }), ctx);
    enabledSchoolId = enabled.school.id;
    enabledUserId = enabled.user.id;
    await basePrisma.school.update({ where: { id: enabledSchoolId }, data: { staffMobileEnabled: true } });
    const setup = await service.setupTwoFactor(enabledUserId, enabledSchoolId);
    secret = setup.secret;
    await service.confirmTwoFactor(enabledUserId, enabledSchoolId, { code: generateSync({ secret }) });

    const disabled = await service.signupOwner(signupOwnerSchema.parse({
      schoolName: "Staff Mobile Control", schoolSlug: `staff-control-${runId}`,
      ownerFirstName: "Control", ownerLastName: "Owner",
      ownerEmail: `control-${runId}@example.test`, ownerPhone: `+234802${Date.now().toString().slice(-6)}`,
      password, ndprConsent: true,
    }), ctx);
    disabledSchoolId = disabled.school.id;
    disabledUserId = disabled.user.id;
  });

  afterAll(async () => {
    await basePrisma.school.deleteMany({ where: { id: { in: [enabledSchoolId, disabledSchoolId] } } });
    await basePrisma.$disconnect();
    await redis.quit();
  });

  it("rejects a correct staff credential while the school rollout flag is off", async () => {
    await expect(service.mobileLogin(staffMobileLoginSchema.parse({
      email: `control-${runId}@example.test`, password, ...device,
    }), ctx)).rejects.toMatchObject({ code: "STAFF_MOBILE_DISABLED" });
    const count = await withTenant(disabledSchoolId, (db) => db.session.count({
      where: { clientType: "MOBILE" },
    }));
    expect(count).toBe(0);
  });

  it("issues no session before 2FA and rejects the mobile challenge at the web audience", async () => {
    const login = await service.mobileLogin(staffMobileLoginSchema.parse({
      email: `mobile-${runId}@example.test`, password, ...device,
    }), ctx);
    expect(login.requiresTwoFactor).toBe(true);
    if (!login.requiresTwoFactor) throw new Error("Expected challenge");
    expect(await withTenant(enabledSchoolId, (db) => db.session.count({ where: { clientType: "MOBILE" } }))).toBe(0);
    await expect(service.loginWithChallenge({
      challengeToken: login.challengeToken, code: generateSync({ secret }),
    }, ctx)).rejects.toMatchObject({ code: "INVALID_2FA_CHALLENGE" });
    await basePrisma.school.update({ where: { id: enabledSchoolId }, data: { staffMobileEnabled: false } });
    try {
      await expect(service.mobileLoginWithChallenge(staffMobileChallengeSchema.parse({
        challengeToken: login.challengeToken, code: generateSync({ secret }), ...device,
      }), ctx)).rejects.toMatchObject({ code: "STAFF_MOBILE_DISABLED" });
    } finally {
      await basePrisma.school.update({ where: { id: enabledSchoolId }, data: { staffMobileEnabled: true } });
    }
  });

  it("binds 2FA to the exact device, then creates one capped mobile session and exact audit", async () => {
    const originalTtl = process.env.STAFF_MOBILE_SESSION_TTL_HOURS;
    process.env.STAFF_MOBILE_SESSION_TTL_HOURS = "999";
    try {
    const login = await service.mobileLogin(staffMobileLoginSchema.parse({
      email: `mobile-${runId}@example.test`, password, ...device,
    }), ctx);
    if (!login.requiresTwoFactor) throw new Error("Expected challenge");
    await expect(service.mobileLoginWithChallenge(staffMobileChallengeSchema.parse({
      challengeToken: login.challengeToken, code: generateSync({ secret }),
      ...device, deviceId: `${device.deviceId}-wrong`,
    }), ctx)).rejects.toMatchObject({ code: "INVALID_2FA_CHALLENGE" });

    const result = await service.mobileLoginWithChallenge(staffMobileChallengeSchema.parse({
      challengeToken: login.challengeToken, code: generateSync({ secret }), ...device,
    }), ctx);
    expect(result.requiresTwoFactor).toBe(false);
    const rows = await withTenant(enabledSchoolId, (db) => db.session.findMany({
      where: { userId: enabledUserId, clientType: "MOBILE" },
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deviceId: device.deviceId, deviceName: device.deviceName });
    const lifetime = rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime();
    expect(lifetime).toBeGreaterThan(167 * 60 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(168 * 60 * 60 * 1000);
    expect(await withTenant(enabledSchoolId, (db) => db.auditLog.count({
      where: { userId: enabledUserId, action: "auth.mobile_login" },
    }))).toBe(1);
    } finally {
      if (originalTtl === undefined) delete process.env.STAFF_MOBILE_SESSION_TTL_HOURS;
      else process.env.STAFF_MOBILE_SESSION_TTL_HOURS = originalTtl;
    }
  });

  it("enforces mobile device attribution at the database boundary", async () => {
    await expect(withTenant(enabledSchoolId, (db) => db.session.create({ data: {
      userId: enabledUserId,
      tokenHash: `invalid-mobile-${runId}`,
      clientType: "MOBILE",
      expiresAt: new Date(Date.now() + 60_000),
    }}))).rejects.toThrow();
    expect(await withTenant(enabledSchoolId, (db) => db.session.count({
      where: { tokenHash: `invalid-mobile-${runId}` },
    }))).toBe(0);
  });

  it("lists only the caller's sessions and revokes immediately with one attributed audit", async () => {
    const mobile = await withTenant(enabledSchoolId, (db) => db.session.findFirstOrThrow({
      where: { userId: enabledUserId, clientType: "MOBILE" },
    }));
    const auth = { sessionId: mobile.id, userId: enabledUserId, schoolId: enabledSchoolId };
    const list = await service.listSessions(auth);
    expect(list.sessions.find((row) => row.id === mobile.id)).toMatchObject({ current: true, deviceName: "Pixel CP1" });
    expect(Object.keys(list.sessions.find((row) => row.id === mobile.id)!).sort()).toEqual([
      "clientType", "createdAt", "current", "deviceName", "expiresAt", "id", "lastSeenAt",
    ]);
    const otherTenantSession = await withTenant(disabledSchoolId, (db) => db.session.findFirstOrThrow({
      where: { userId: disabledUserId },
    }));
    await expect(service.revokeSession(auth, otherTenantSession.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await withTenant(disabledSchoolId, (db) => db.session.count({ where: { id: otherTenantSession.id } }))).toBe(1);
    await setCachedSession(redis, mobile.tokenHash, {
      session_id: mobile.id, user_id: enabledUserId, school_id: enabledSchoolId,
      expires_at: mobile.expiresAt.toISOString(), user_is_active: true,
    });
    expect(await getCachedSession(redis, mobile.tokenHash)).not.toBeNull();
    await service.revokeSession(auth, mobile.id, ctx);
    expect(await getCachedSession(redis, mobile.tokenHash)).toBeNull();
    expect(await withTenant(enabledSchoolId, (db) => db.session.count({ where: { id: mobile.id } }))).toBe(0);
    expect(await withTenant(enabledSchoolId, (db) => db.auditLog.count({
      where: { action: "auth.session_revoked", entityId: mobile.id, userId: enabledUserId },
    }))).toBe(1);
  });
});
