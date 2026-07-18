import * as cryptoModule from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant } from "@school-kit/db";

import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { PortalStudentsModule } from "./portal-students.module";

// Phase 4 / Slice 3 — the acceptance bar named in docs/modules/phase-4.md
// §3/§4: "guardian A cannot see guardian B's child in the SAME school" is
// the case RLS alone can't catch (both students share school_id; only
// withGuardian()'s student_guardians link check distinguishes them). Real
// HTTP requests through GuardianAuthGuard, not just direct service calls,
// so the guard's actual wiring is proven too, not assumed.
//
// Fixtures are built directly via basePrisma/withTenant (not the real
// signup/invite-accept HTTP flow) — this suite is about the authorization
// boundary, not the onboarding flow already covered by portal-auth's own
// specs.

describe("PortalStudentsController (Phase 4 / Slice 3)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const schoolIdsToCleanup = new Set<string>();
  let app: INestApplication;

  let schoolA: string;
  let schoolB: string;
  let guardianA1: string; // linked to studentA1 only
  let guardianA2: string; // linked to studentA2 only
  let guardianAEmpty: string; // no children at all
  let guardianB1: string; // school B
  let studentA1: string;
  let studentA2: string;
  let studentB1: string;
  let tokenA1: string;
  let tokenA2: string;
  let tokenAEmpty: string;
  let tokenB1: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PortalStudentsModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const schoolRowA = await basePrisma.school.create({
      data: { name: `Portal Students Spec A ${runId}`, slug: `portal-students-a-${runId}` },
      select: { id: true },
    });
    schoolA = schoolRowA.id;
    schoolIdsToCleanup.add(schoolA);

    const schoolRowB = await basePrisma.school.create({
      data: { name: `Portal Students Spec B ${runId}`, slug: `portal-students-b-${runId}` },
      select: { id: true },
    });
    schoolB = schoolRowB.id;
    schoolIdsToCleanup.add(schoolB);

    await withTenant(schoolA, async (db) => {
      const gA1 = await db.guardian.create({
        data: { schoolId: schoolA, firstName: "Ada", lastName: `GuardianA1-${runId}`, relationship: "MOTHER", phone: `+234801${runId}1` },
        select: { id: true },
      });
      const gA2 = await db.guardian.create({
        data: { schoolId: schoolA, firstName: "Bola", lastName: `GuardianA2-${runId}`, relationship: "FATHER", phone: `+234801${runId}2` },
        select: { id: true },
      });
      const gAEmpty = await db.guardian.create({
        data: { schoolId: schoolA, firstName: "Chi", lastName: `GuardianAEmpty-${runId}`, relationship: "GUARDIAN", phone: `+234801${runId}3` },
        select: { id: true },
      });
      guardianA1 = gA1.id;
      guardianA2 = gA2.id;
      guardianAEmpty = gAEmpty.id;

      const sA1 = await db.student.create({
        data: {
          schoolId: schoolA,
          admissionNumber: `ADM-PS-A1-${runId}`,
          firstName: "Student",
          lastName: `A1-${runId}`,
          dateOfBirth: new Date("2015-01-01"),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      const sA2 = await db.student.create({
        data: {
          schoolId: schoolA,
          admissionNumber: `ADM-PS-A2-${runId}`,
          firstName: "Student",
          lastName: `A2-${runId}`,
          dateOfBirth: new Date("2016-01-01"),
          gender: "MALE",
        },
        select: { id: true },
      });
      studentA1 = sA1.id;
      studentA2 = sA2.id;

      await db.studentGuardian.create({
        data: { schoolId: schoolA, studentId: studentA1, guardianId: guardianA1, isPrimary: true, canPickup: true },
      });
      await db.studentGuardian.create({
        data: { schoolId: schoolA, studentId: studentA2, guardianId: guardianA2, isPrimary: true, canPickup: true },
      });
    });

    await withTenant(schoolB, async (db) => {
      const gB1 = await db.guardian.create({
        data: { schoolId: schoolB, firstName: "Dupe", lastName: `GuardianB1-${runId}`, relationship: "MOTHER", phone: `+234801${runId}4` },
        select: { id: true },
      });
      guardianB1 = gB1.id;

      const sB1 = await db.student.create({
        data: {
          schoolId: schoolB,
          admissionNumber: `ADM-PS-B1-${runId}`,
          firstName: "Student",
          lastName: `B1-${runId}`,
          dateOfBirth: new Date("2015-06-01"),
          gender: "OTHER",
        },
        select: { id: true },
      });
      studentB1 = sB1.id;

      await db.studentGuardian.create({
        data: { schoolId: schoolB, studentId: studentB1, guardianId: guardianB1, isPrimary: true, canPickup: true },
      });
    });

    ({ rawToken: tokenA1 } = await createGuardianSession(schoolA, guardianA1, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
    ({ rawToken: tokenA2 } = await createGuardianSession(schoolA, guardianA2, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
    ({ rawToken: tokenAEmpty } = await createGuardianSession(schoolA, guardianAEmpty, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
    ({ rawToken: tokenB1 } = await createGuardianSession(schoolB, guardianB1, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // ---------------------------------------------------------------------
  // GET /portal/students — list scoping
  // ---------------------------------------------------------------------

  it("returns only the calling guardian's own linked children", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/portal/students")
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toEqual([studentA1]);
  });

  it("a different guardian in the same school sees their own child, not the other family's", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/portal/students")
      .set("Authorization", `Bearer ${tokenA2}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toEqual([studentA2]);
  });

  it("a guardian with zero linked children gets an empty list, not an error", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/portal/students")
      .set("Authorization", `Bearer ${tokenAEmpty}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // GET /portal/students/:id — the withGuardian() proof
  // ---------------------------------------------------------------------

  it("a guardian can fetch their own linked child's detail", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentA1}`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(studentA1);
    expect(res.body.isPrimary).toBe(true);
  });

  it("detail response contains exactly the narrow portal field set — no admin-only fields leak through", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentA1}`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(200);
    // Exact key-set match, not spot-checks: catches an admin-only field
    // (notes, medicalNotes, religion, stateOfOrigin, address, phone,
    // email, bloodGroup, nationality, schoolId, timestamps, ...)
    // leaking in via a future mapping bug (e.g. someone swapping the
    // explicit toPortalStudentDto() field list for a `...student`
    // spread), AND catches an expected field going missing — either
    // direction would otherwise pass the value-only assertions above.
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "id",
        "admissionNumber",
        "firstName",
        "middleName",
        "lastName",
        "dateOfBirth",
        "gender",
        "photoUrl",
        "status",
        "isPrimary",
        "canPickup",
        "currentEnrollment",
      ].sort(),
    );
  });

  it("list response rows carry the same exact field set as the detail response", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/portal/students")
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      [
        "id",
        "admissionNumber",
        "firstName",
        "middleName",
        "lastName",
        "dateOfBirth",
        "gender",
        "photoUrl",
        "status",
        "isPrimary",
        "canPickup",
        "currentEnrollment",
      ].sort(),
    );
  });

  it("SAME-SCHOOL cross-guardian block: guardian A1 cannot fetch A2's child, even though RLS alone would allow it (both in school A)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentA2}`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("CROSS-TENANT block: guardian A1 cannot fetch school B's child", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentB1}`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("guardian B1 (school B) cannot fetch school A's children either, symmetrically", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentA1}`)
      .set("Authorization", `Bearer ${tokenB1}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  // ---------------------------------------------------------------------
  // GuardianAuthGuard — confirming it's actually wired, not just present
  // ---------------------------------------------------------------------

  it("no bearer token → 401", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/portal/students");
    expect(res.status).toBe(401);
  });

  it("garbage bearer token → 401", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/portal/students")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("expired session → 401", async () => {
    // createGuardianSession always mints a future expiresAt, so the expired
    // case is built by hand: a real, resolvable token hash, backdated.
    const rawToken = cryptoModule.randomBytes(32).toString("base64url");
    const tokenHash = cryptoModule.createHash("sha256").update(rawToken).digest("hex");
    await withTenant(schoolA, (db) =>
      db.guardianSession.create({
        data: { guardianId: guardianA1, tokenHash, expiresAt: new Date(Date.now() - 1000) },
      }),
    );

    const res = await request(app.getHttpServer())
      .get("/api/v1/portal/students")
      .set("Authorization", `Bearer ${rawToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");
  });
});
