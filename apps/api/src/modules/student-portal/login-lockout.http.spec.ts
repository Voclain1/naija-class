import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { Global, INestApplication, Module } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant } from "@school-kit/db";

import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { LoginLockoutService, lockoutIdentity } from "../../common/auth/login-lockout";
import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import * as password from "../../common/auth/password";
import { PortalStudentsModule } from "../portal-students/portal-students.module";
import { StudentPortalModule } from "./student-portal.module";

// Student portal login lockout (2026-10-02) over real HTTP, against REAL
// Redis — the design approved at the Phase 6 / Slice 3 review
// (docs/deferred.md). The other student-portal specs mock Redis inert; this
// one exists so the lockout is tested where it actually runs.
//
// The two properties the review called "as important as the numbers":
//   1. an admission number that does not exist locks EXACTLY like one that
//      does — over the wire, header and body, not just in the service;
//   2. invitation-accept is never locked, and it lifts the lock — the parent's
//      way out of a scripted cohort-wide lock.

const realRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
@Global()
@Module({
  providers: [{ provide: REDIS_AUTH_CLIENT, useValue: realRedis }],
  exports: [REDIS_AUTH_CLIENT],
})
class RealRedisAuthModule {}

const PASSWORD = "correct-horse-battery";

describe("Student portal — login lockout over HTTP", () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const runId = Date.now().toString(36);
  const slug = `lock-${runId}`;
  const lockout = new LoginLockoutService(realRedis);
  let schoolId: string;
  let guardianToken: string;
  const students: Record<"probe" | "correct" | "clear" | "recover", { id: string; adm: string }> = {} as never;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), RealRedisAuthModule, StudentPortalModule, PortalStudentsModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = request(app.getHttpServer());

    schoolId = (await basePrisma.school.create({ data: { name: `Lockout ${runId}`, slug }, select: { id: true } })).id;
    const hash = await password.hashPassword(PASSWORD);
    let guardianId = "";
    await withTenant(schoolId, async (db) => {
      const g = await db.guardian.create({
        data: {
          schoolId,
          firstName: "Lock",
          lastName: `G-${runId}`,
          relationship: "MOTHER",
          phone: `+2348091${runId.slice(-7)}`,
          email: `lock-${runId}@example.test`,
        },
        select: { id: true },
      });
      guardianId = g.id;
      for (const key of Object.keys({ probe: 0, correct: 0, clear: 0, recover: 0 }) as Array<keyof typeof students>) {
        const adm = `ADM-${key}-${runId}`;
        const s = await db.student.create({
          data: {
            schoolId,
            admissionNumber: adm,
            firstName: key,
            lastName: `Lock-${runId}`,
            dateOfBirth: new Date("2010-01-01"),
            gender: "FEMALE",
            status: "ACTIVE",
            passwordHash: hash,
            activatedAt: new Date(),
          },
          select: { id: true },
        });
        students[key] = { id: s.id, adm };
        await db.studentGuardian.create({ data: { schoolId, studentId: s.id, guardianId: g.id, isPrimary: true } });
      }
    });
    guardianToken = (await createGuardianSession(schoolId, guardianId, { ipAddress: null, userAgent: null })).rawToken;
  });

  afterAll(async () => {
    await withTenant(schoolId, async (db) => {
      await db.studentSession.deleteMany({});
      await db.studentPortalInvitation.deleteMany({});
      await db.auditLog.deleteMany({});
      await db.studentGuardian.deleteMany({});
      await db.guardianSession.deleteMany({});
      await db.student.deleteMany({});
      await db.guardian.deleteMany({});
    });
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    await app.close();
    await realRedis.quit();
  });

  const login = (adm: string, pw = "definitely-wrong") =>
    http.post("/api/v1/student-portal/login").send({ schoolSlug: slug, admissionNumber: adm, password: pw });

  async function failTimes(adm: string, n: number) {
    for (let i = 0; i < n; i++) {
      const res = await login(adm);
      expect(res.status).toBe(401);
    }
  }

  it("a made-up admission number locks exactly like a real one — status, Retry-After and body", async () => {
    const fake = `ADM-NOBODY-${runId}`;
    await failTimes(students.probe.adm, 6);
    await failTimes(fake, 6);

    const [real, made] = await Promise.all([login(students.probe.adm), login(fake)]);
    for (const res of [real, made]) {
      expect(res.status).toBe(429);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.body.error.code).toBe("LOGIN_LOCKED");
    }
    expect(real.body).toEqual(made.body);
  });

  it("a locked account refuses even the correct password", async () => {
    await failTimes(students.correct.adm, 6);
    const res = await login(students.correct.adm, PASSWORD);
    expect(res.status).toBe(429);
  });

  it("a correct sign-in clears the count", async () => {
    await failTimes(students.clear.adm, 5);
    expect((await login(students.clear.adm, PASSWORD)).status).toBe(200);
    // Five more are free again, and the sixth is a wrong password, not a lock.
    await failTimes(students.clear.adm, 6);
  });

  it("invitation-accept is never locked, and lifts even a hard lock", async () => {
    // Drive straight to a hard lock: eleven failures.
    const identity = lockoutIdentity("student", slug, students.recover.adm);
    for (let i = 0; i < 11; i++) await lockout.recordFailure(identity);
    const locked = await login(students.recover.adm, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBe(String(15 * 60));

    // The parent's way out: a fresh link, accepted while the lock is live.
    const reset = await http
      .post(`/api/v1/portal/students/${students.recover.id}/password-reset`)
      .set("Authorization", `Bearer ${guardianToken}`)
      .expect(200);
    await http
      .post(`/api/v1/student-portal/invitations/${reset.body.token}/accept`)
      .send({ password: "Recovered-Student-1" })
      .expect(200);

    expect((await login(students.recover.adm, "Recovered-Student-1")).status).toBe(200);
  });
});
