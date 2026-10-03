// A school switching a parent's portal access off (2026-10-02) — proven at
// the HTTP boundary, through the real GuardianAuthGuard and the real
// auth_resolve_guardian_session, against a real database.
//
// The guard is tested separately from GuardiansService.deactivatePortal on
// purpose. deactivatePortal ALSO deletes the parent's sessions, so a test that
// went through it would pass even if the guard ignored portal_enabled
// entirely — the session would simply be gone. Here the session is left in
// place and only portal_disabled_at is set, which is the case the guard's
// check exists for: the switch must be authoritative on its own, even for a
// session that survived.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { INestApplication, Global, Module } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant } from "@school-kit/db";

import { HttpExceptionFilter } from "../common/http-exception.filter";
import { createGuardianSession } from "../common/auth/guardian-sessions";
import { PortalStudentsModule } from "../modules/portal-students/portal-students.module";
import { REDIS_AUTH_CLIENT } from "../common/auth/redis-auth.provider";

// PortalStudentsModule now carries the result-PIN lockout (Phase 8c / CP6b),
// which needs the Redis client the app provides globally. This spec never
// redeems a PIN, so an inert stand-in is enough.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_AUTH_CLIENT,
      useValue: {
        get: async () => null,
        set: async () => "OK",
        del: async () => 1,
        pttl: async () => -2,
        incr: async () => 1,
        expire: async () => 1,
      },
    },
  ],
  exports: [REDIS_AUTH_CLIENT],
})
class InertRedisAuthModule {}


describe("GuardianAuthGuard — portal access switched off by the school", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let app: INestApplication;
  let schoolId: string;
  let guardianId: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InertRedisAuthModule, PortalStudentsModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const school = await basePrisma.school.create({
      data: { name: `Guardian Access Spec ${runId}`, slug: `guardian-access-${runId}` },
      select: { id: true },
    });
    schoolId = school.id;

    const guardian = await withTenant(schoolId, (db) =>
      db.guardian.create({
        data: {
          schoolId,
          firstName: "Ngozi",
          lastName: `Access-${runId}`,
          relationship: "MOTHER",
          phone: `+234802${runId.replace(/\D/g, "0").padEnd(7, "0").slice(0, 7)}`,
          email: `access-${runId}@example.test`,
          passwordHash: "argon2-not-a-real-hash",
        },
        select: { id: true },
      }),
    );
    guardianId = guardian.id;
    token = (
      await createGuardianSession(schoolId, guardianId, { ipAddress: "127.0.0.1", userAgent: "vitest" })
    ).rawToken;
  });

  afterAll(async () => {
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    await app.close();
    await basePrisma.$disconnect();
  });

  const call = () =>
    request(app.getHttpServer()).get("/api/v1/portal/students").set("Authorization", `Bearer ${token}`);
  const setDisabledAt = (value: Date | null) =>
    withTenant(schoolId, (db) =>
      db.guardian.update({ where: { id: guardianId }, data: { portalDisabledAt: value } }),
    );

  it("a live session is refused with USER_INACTIVE the moment access is switched off — without its session being deleted", async () => {
    // Control: the same token works first, so the refusal is the switch.
    expect((await call()).status).toBe(200);

    await setDisabledAt(new Date());
    try {
      const refused = await call();
      expect(refused.status).toBe(401);
      // USER_INACTIVE, not INVALID_SESSION: the parent is told the school
      // switched access off (the portal and the app both map this code to
      // "contact the school"), rather than "sign in again", which would fail.
      expect(refused.body.error.code).toBe("USER_INACTIVE");

      // The session row still exists — the refusal came from the guard's
      // portal_enabled check alone.
      const sessions = await withTenant(schoolId, (db) =>
        db.guardianSession.count({ where: { guardianId } }),
      );
      expect(sessions).toBe(1);
    } finally {
      await setDisabledAt(null);
    }
  });

  it("switching access back on restores the same session — nothing else needed", async () => {
    expect((await call()).status).toBe(200);
  });

  it("the resolver itself reports portal_enabled, in both directions", async () => {
    const { createHash } = await import("node:crypto");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const resolve = async () =>
      (
        await basePrisma.$queryRawUnsafe<Array<{ portal_enabled: boolean }>>(
          `SELECT portal_enabled FROM auth_resolve_guardian_session($1)`,
          tokenHash,
        )
      )[0]?.portal_enabled;

    expect(await resolve()).toBe(true);
    await setDisabledAt(new Date());
    try {
      expect(await resolve()).toBe(false);
    } finally {
      await setDisabledAt(null);
    }
  });
});
