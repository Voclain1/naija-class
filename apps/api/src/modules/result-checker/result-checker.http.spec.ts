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
import { createStudentSession } from "../../common/auth/student-sessions";
import { LoginLockoutService, lockoutIdentity } from "../../common/auth/login-lockout";
import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { StorageModule } from "../../common/storage";
import { PortalStudentsModule } from "../portal-students/portal-students.module";
import { StudentPortalModule } from "../student-portal/student-portal.module";
import { hashPin, resolveResultPinKey } from "./result-pin-key";
import { ResultCheckerModule } from "./result-checker.module";

// The public Result Checker and the portal unlocks (Phase 8c / CP6b,
// docs/modules/phase-8.md §21.4–21.5), over real HTTP, real Postgres and REAL
// Redis — the lockout is tested where it actually runs.

const realRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
@Global()
@Module({ providers: [{ provide: REDIS_AUTH_CLIENT, useValue: realRedis }], exports: [REDIS_AUTH_CLIENT] })
class RealRedisAuthModule {}

const KEY = resolveResultPinKey();

describe("Result Checker — public check and portal unlock over HTTP", () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const runId = Math.random().toString(36).slice(2, 8);
  const slug = `chk-${runId}`;
  let schoolId = "";
  let otherSchoolSlug = "";
  let otherSchoolId = "";
  const ids = {} as {
    year: string;
    term1: string;
    term2: string;
    arm: string;
    ada: string;
    bola: string;
    chi: string;
    adaGuardian: string;
    bolaGuardian: string;
  };
  let adaGuardianToken = "";
  let bolaGuardianToken = "";
  let adaToken = "";
  let pinSeq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        RealRedisAuthModule,
        StorageModule,
        ResultCheckerModule,
        PortalStudentsModule,
        StudentPortalModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = request(app.getHttpServer());

    schoolId = (await basePrisma.school.create({ data: { name: `Checker ${runId}`, slug }, select: { id: true } })).id;
    otherSchoolSlug = `chk-other-${runId}`;
    otherSchoolId = (await basePrisma.school.create({ data: { name: `Other ${runId}`, slug: otherSchoolSlug }, select: { id: true } })).id;

    await withTenant(schoolId, async (db) => {
      ids.year = (await db.academicYear.create({
        data: { schoolId, label: "2025/2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      })).id;
      const mkTerm = async (sequence: number, name: string) =>
        (await db.term.create({
          data: { schoolId, academicYearId: ids.year, sequence, name, startDate: new Date(`2025-0${sequence + 8}-01`), endDate: new Date(`2025-0${sequence + 8}-28`) },
          select: { id: true },
        })).id;
      ids.term1 = await mkTerm(1, "First Term");
      ids.term2 = await mkTerm(2, "Second Term");
      const level = await db.classLevel.create({ data: { schoolId, name: "JSS 1", code: `j1-${runId}`, orderIndex: 1, stage: "JSS" }, select: { id: true } });
      ids.arm = (await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS 1 A", code: `j1a-${runId}` }, select: { id: true } })).id;

      const mkStudent = async (name: string, adm: string) =>
        (await db.student.create({
          data: { schoolId, admissionNumber: adm, firstName: name, lastName: `Chk-${runId}`, dateOfBirth: new Date("2012-01-01"), gender: "FEMALE", status: "ACTIVE", passwordHash: "argon2-not-a-real-hash", activatedAt: new Date() },
          select: { id: true },
        })).id;
      ids.ada = await mkStudent("Ada", "ADM/001");
      ids.bola = await mkStudent("Bola", "ADM/002");
      ids.chi = await mkStudent("Chi", "ADM/003");

      const mkCard = (studentId: string, termId: string, status: "RELEASED" | "DRAFT", accessMode: "PIN" | "FREE" | null) =>
        db.reportCard.create({
          data: {
            schoolId, studentId, termId, academicYearId: ids.year, classArmId: ids.arm, status, accessMode,
            overallTotal: 410, overallAverage: 8200, subjectsCount: 5, formTeacherComment: "Steady work.",
            ...(status === "RELEASED" ? { releasedAt: new Date() } : {}),
          },
        });
      await mkCard(ids.ada, ids.term1, "RELEASED", "PIN");
      await mkCard(ids.bola, ids.term1, "RELEASED", "PIN");
      await mkCard(ids.chi, ids.term1, "RELEASED", "FREE");
      await mkCard(ids.ada, ids.term2, "DRAFT", null);

      const mkGuardian = async (name: string, phone: string) =>
        (await db.guardian.create({
          data: { schoolId, firstName: name, lastName: `G-${runId}`, relationship: "MOTHER", phone, email: `${name}-${runId}@example.test`, passwordHash: "argon2-not-a-real-hash" },
          select: { id: true },
        })).id;
      ids.adaGuardian = await mkGuardian("adamum", `+23481${String(Date.now()).slice(-8)}`);
      ids.bolaGuardian = await mkGuardian("bolamum", `+23482${String(Date.now()).slice(-8)}`);
      await db.studentGuardian.createMany({
        data: [
          { schoolId, studentId: ids.ada, guardianId: ids.adaGuardian, isPrimary: true },
          { schoolId, studentId: ids.bola, guardianId: ids.bolaGuardian, isPrimary: true },
        ],
      });
    });

    adaGuardianToken = (await createGuardianSession(schoolId, ids.adaGuardian, { ipAddress: null, userAgent: null })).rawToken;
    bolaGuardianToken = (await createGuardianSession(schoolId, ids.bolaGuardian, { ipAddress: null, userAgent: null })).rawToken;
    adaToken = (await createStudentSession(schoolId, ids.ada, { ipAddress: null, userAgent: null })).rawToken;
  });

  afterAll(async () => {
    for (const id of [schoolId, otherSchoolId]) {
      await withTenant(id, async (db) => {
        await db.resultUnlock.deleteMany({});
        await db.resultPin.deleteMany({});
        await db.resultPinBatch.deleteMany({});
        await db.auditLog.deleteMany({});
        await db.reportCard.deleteMany({});
        await db.studentSession.deleteMany({});
        await db.guardianSession.deleteMany({});
        await db.studentGuardian.deleteMany({});
        await db.student.deleteMany({});
        await db.guardian.deleteMany({});
        await db.term.deleteMany({});
        await db.classArm.deleteMany({});
        await db.classLevel.deleteMany({});
        await db.academicYear.deleteMany({});
      });
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
    await realRedis.quit();
  });

  /** A fresh PIN for a term, inserted the way generateBatch stores it. */
  async function newPin(termId: string, maxUses = 5): Promise<string> {
    pinSeq += 1;
    const digits = `${String(pinSeq).padStart(4, "0")}${runId.replace(/\D/g, "1").padEnd(4, "7").slice(0, 4)}${String(Date.now()).slice(-4)}`;
    await withTenant(schoolId, async (db) => {
      const batch = await db.resultPinBatch.create({
        data: { schoolId, academicYearId: ids.year, termId, number: pinSeq, size: 1, maxUses, createdBy: "spec" },
      });
      await db.resultPin.create({
        data: { schoolId, batchId: batch.id, serial: `B${pinSeq}-0001`, pinHash: hashPin(KEY, digits) },
      });
    });
    return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
  }

  const check = (body: { admissionNumber: string; pin: string; termId: string }, s = slug) =>
    http.post(`/api/v1/result-checker/${s}/check`).send(body);

  it("the school page names the school and only the terms with PIN results — nothing about a student", async () => {
    const res = await http.get(`/api/v1/result-checker/${slug}`).expect(200);
    expect(res.body).toEqual({
      schoolName: `Checker ${runId}`,
      terms: [{ termId: ids.term1, termName: "First Term", academicYearLabel: "2025/2026" }],
    });
    await http.get(`/api/v1/result-checker/no-such-${runId}`).expect(404);
  });

  it("CONTROL — admission number + PIN + term opens the result, with uses left and no PDF link until one exists", async () => {
    const pin = await newPin(ids.term1);
    const res = await check({ admissionNumber: "ADM/001", pin, termId: ids.term1 }).expect(200);
    expect(res.body.result.student.id).toBe(ids.ada);
    expect(res.body.result.overallAverage).toBe(8200);
    expect(res.body.usesLeft).toBe(4);
    expect(res.body.pdfUrl).toBeNull();

    await withTenant(schoolId, (db) =>
      db.reportCard.updateMany({ where: { studentId: ids.ada, termId: ids.term1 }, data: { pdfStatus: "GENERATED" } }),
    );
    const withPdf = await check({ admissionNumber: "ADM/001", pin, termId: ids.term1 }).expect(200);
    expect(typeof withPdf.body.pdfUrl).toBe("string");
    expect(withPdf.body.usesLeft).toBe(3);
  });

  it("every way of being wrong gets the SAME answer — status, code and message", async () => {
    const pinForBola = await newPin(ids.term1);
    await check({ admissionNumber: "ADM/002", pin: pinForBola, termId: ids.term1 }).expect(200); // binds to Bola
    const term2Pin = await newPin(ids.term2);
    const unusedTerm1Pin = await newPin(ids.term1);

    const attempts = await Promise.all([
      check({ admissionNumber: "ADM/999", pin: unusedTerm1Pin, termId: ids.term1 }), // no such student
      check({ admissionNumber: "ADM/001", pin: "1111 2222 3333", termId: ids.term1 }), // unknown PIN
      check({ admissionNumber: "ADM/001", pin: "12", termId: ids.term1 }), // malformed PIN
      check({ admissionNumber: "ADM/001", pin: pinForBola, termId: ids.term1 }), // another student's card
      check({ admissionNumber: "ADM/001", pin: term2Pin, termId: ids.term1 }), // another term's card
      check({ admissionNumber: "ADM/001", pin: term2Pin, termId: ids.term2 }), // unreleased card
      check({ admissionNumber: "ADM/003", pin: unusedTerm1Pin, termId: ids.term1 }), // FREE card
      check({ admissionNumber: "ADM/001", pin: unusedTerm1Pin, termId: ids.term1 }, otherSchoolSlug), // other school
      check({ admissionNumber: "ADM/001", pin: unusedTerm1Pin, termId: ids.term1 }, `nowhere-${runId}`), // no school
    ]);
    const first = attempts[0]!;
    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe("RESULT_CHECK_NO_MATCH");
    for (const res of attempts) {
      expect(res.status).toBe(first.status);
      expect(res.body).toEqual(first.body);
    }

    // None of those took a use or bound the unused card — a FREE card least of all.
    const spare = await withTenant(schoolId, (db) =>
      db.resultPin.findMany({ where: { boundStudentId: null }, select: { uses: true } }),
    );
    expect(spare.every((p) => p.uses === 0)).toBe(true);

    // The school's audit trail records why; the response above never did. Never the PIN.
    const failures = await withTenant(schoolId, (db) =>
      db.auditLog.findMany({ where: { action: "result-checker.check-failed" }, select: { metadata: true } }),
    );
    const reasons = failures.map((f) => (f.metadata as { reason: string }).reason);
    expect(reasons).toEqual(expect.arrayContaining(["NO_STUDENT", "PIN_INVALID", "PIN_OTHER_STUDENT", "PIN_WRONG_TERM", "NOT_RELEASED", "FREE"]));
    expect(JSON.stringify(failures)).not.toContain(unusedTerm1Pin.replace(/ /g, ""));
  });

  it("the one distinct answer: a valid card for THIS student with no uses left", async () => {
    const pin = await newPin(ids.term1, 1);
    await check({ admissionNumber: "ADM/002", pin, termId: ids.term1 }).expect(200);
    const spent = await check({ admissionNumber: "ADM/002", pin, termId: ids.term1 }).expect(400);
    expect(spent.body.error.code).toBe("PIN_USED_UP");
  });

  it("a made-up admission number locks exactly like a real one", async () => {
    const fake = { admissionNumber: `ADM/FAKE-${runId}`, pin: "1111 2222 3333", termId: ids.term1 };
    const real = { admissionNumber: "ADM/003", pin: "1111 2222 3333", termId: ids.term1 };
    // ADM/003 failed once in an earlier test; start both counters from zero.
    await new LoginLockoutService(realRedis).clear(lockoutIdentity("checker", slug, real.admissionNumber));
    for (let i = 0; i < 6; i++) {
      await check(fake).expect(400);
      await check(real).expect(400);
    }
    const [a, b] = await Promise.all([check(fake), check(real)]);
    for (const res of [a, b]) {
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("LOGIN_LOCKED");
      expect(res.headers["retry-after"]).toBe("5");
    }
    expect(a.body).toEqual(b.body);
  });

  it("a parent unlocks a locked term in the portal, and then it is open EVERYWHERE — the child's app too (D17)", async () => {
    // Fresh slate for Ada on term 1: no unlock yet.
    await withTenant(schoolId, (db) => db.resultUnlock.deleteMany({ where: { studentId: ids.ada } }));
    const asGuardian = (path: string) => http.get(`/api/v1/portal${path}`).set("Authorization", `Bearer ${adaGuardianToken}`);
    const asChild = (path: string) => http.get(`/api/v1/student-portal${path}`).set("Authorization", `Bearer ${adaToken}`);

    expect((await asGuardian(`/students/${ids.ada}/results/${ids.term1}`)).status).toBe(403);
    expect((await asChild(`/me/results/${ids.term1}`)).status).toBe(403);

    const wrong = await http
      .post(`/api/v1/portal/students/${ids.ada}/results/${ids.term1}/unlock`)
      .set("Authorization", `Bearer ${adaGuardianToken}`)
      .send({ pin: "9999 9999 9999" })
      .expect(400);
    expect(wrong.body.error.code).toBe("PIN_INVALID");

    const pin = await newPin(ids.term1);
    const unlocked = await http
      .post(`/api/v1/portal/students/${ids.ada}/results/${ids.term1}/unlock`)
      .set("Authorization", `Bearer ${adaGuardianToken}`)
      .send({ pin })
      .expect(200);
    expect(unlocked.body.student.id).toBe(ids.ada);

    expect((await asGuardian(`/students/${ids.ada}/results/${ids.term1}`)).status).toBe(200);
    expect((await asChild(`/me/results/${ids.term1}`)).status).toBe(200);
    // One use taken, to unlock — and none for reading it afterwards.
    const row = await withTenant(schoolId, (db) =>
      db.resultPin.findFirstOrThrow({ where: { serial: `B${pinSeq}-0001` }, select: { uses: true } }),
    );
    expect(row.uses).toBe(1);
  });

  it("a parent cannot use the unlock to reach another family's child — 403, and the card is untouched", async () => {
    const pin = await newPin(ids.term1);
    const res = await http
      .post(`/api/v1/portal/students/${ids.ada}/results/${ids.term1}/unlock`)
      .set("Authorization", `Bearer ${bolaGuardianToken}`)
      .send({ pin });
    expect(res.status).toBe(403);
    const row = await withTenant(schoolId, (db) =>
      db.resultPin.findFirstOrThrow({ where: { serial: `B${pinSeq}-0001` }, select: { uses: true, boundStudentId: true } }),
    );
    expect(row).toEqual({ uses: 0, boundStudentId: null });
  });

  it("a student unlocks their own locked term from the app", async () => {
    await withTenant(schoolId, (db) => db.resultUnlock.deleteMany({ where: { studentId: ids.ada } }));
    const pin = await newPin(ids.term1);
    const res = await http
      .post(`/api/v1/student-portal/me/results/${ids.term1}/unlock`)
      .set("Authorization", `Bearer ${adaToken}`)
      .send({ pin })
      .expect(200);
    expect(res.body.student.id).toBe(ids.ada);
    const unlock = await withTenant(schoolId, (db) =>
      db.resultUnlock.findFirstOrThrow({ where: { studentId: ids.ada, termId: ids.term1 }, select: { via: true } }),
    );
    expect(unlock.via).toBe("STUDENT");
  });
});
