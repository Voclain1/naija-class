import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { Global, INestApplication, Module } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant, type ReportCardStatus } from "@school-kit/db";

import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { createStudentSession } from "../../common/auth/student-sessions";
import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { FAMILY_VISIBLE_POSITION } from "../report-cards/released-results.service";
import * as password from "../../common/auth/password";
import { PortalStudentsModule } from "../portal-students/portal-students.module";
import { StudentPortalModule } from "./student-portal.module";

// Phase 6 / Slice 4 — the RELEASED gate, walked negatively.
//
// The constraint this slice was built under is "nothing is shown to the
// student earlier than it is shown to the guardian". D28 implements that as
// one shared service rather than two endpoints that filter alike. This suite
// is what proves the gate actually holds, and — case 4 — that the two
// principals genuinely see the SAME thing rather than two things that happen
// to look similar today.
//
// Every unreleased status gets its own case, because "not RELEASED" is four
// distinct states and a filter that leaked any one of them would be a filter
// that leaked marks a teacher was still editing.

const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
};
@Global()
@Module({
  providers: [{ provide: REDIS_AUTH_CLIENT, useValue: mockRedis }],
  exports: [REDIS_AUTH_CLIENT],
})
class MockRedisAuthModule {}

const UNRELEASED: ReportCardStatus[] = [
  "DRAFT",
  "SUBJECT_REVIEWED",
  "FORM_REVIEWED",
  "PRINCIPAL_APPROVED",
];

describe("Released results — negative walk (Phase 6 / Slice 4)", () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  const runId = Date.now().toString(36);
  let schoolA: string;
  let schoolB: string;

  // School A: two families. Ada is our subject; Bola is another family's
  // child in the SAME school — the case RLS does not cover.
  let adaId = "";
  let bolaId = "";
  let chiId = ""; // school B
  let adaToken = "";
  let chiToken = "";
  let adaGuardianToken = "";
  let bolaGuardianToken = "";

  // Ada's terms: one RELEASED, and one per unreleased status.
  let releasedTermId = "";
  const unreleasedTermIds: Record<string, string> = {};

  const schoolIds = new Set<string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MockRedisAuthModule,
        StudentPortalModule,
        PortalStudentsModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = request(app.getHttpServer());

    const mkSchool = async (tag: string) =>
      (
        await basePrisma.school.create({
          data: { name: `Results ${tag} ${runId}`, slug: `res-${tag}-${runId}` },
          select: { id: true },
        })
      ).id;
    schoolA = await mkSchool("a");
    schoolB = await mkSchool("b");
    schoolIds.add(schoolA).add(schoolB);

    let adaGuardianId = "";
    let bolaGuardianId = "";
    // Students must carry a password hash: auth_resolve_student_session
    // derives portal_enabled from `password_hash IS NOT NULL`, so a fixture
    // student without one is refused by the guard before any results logic
    // runs — correctly, but it would make this whole suite pass for the
    // wrong reason.
    const hash = await password.hashPassword("results-walk-password");

    await withTenant(schoolA, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId: schoolA,
          label: `2025/2026 ${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      const level = await db.classLevel.create({
        data: {
          schoolId: schoolA,
          name: `JSS1 ${runId}`,
          code: `jss1-${runId}`,
          stage: "JSS",
          orderIndex: 1,
        },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: {
          schoolId: schoolA,
          classLevelId: level.id,
          name: `JSS 1A ${runId}`,
          code: `jss1-a-${runId}`,
        },
        select: { id: true },
      });

      // Five terms in one year is not a realistic academic calendar; it is
      // the cheapest way to get one card per ReportCardStatus, and
      // @@unique([academicYearId, sequence]) is the only thing that cares.
      let seq = 0;
      const mkTerm = async (name: string) =>
        (
          await db.term.create({
            data: {
              schoolId: schoolA,
              academicYearId: year.id,
              sequence: ++seq,
              name,
              startDate: new Date("2025-09-01"),
              endDate: new Date("2025-12-15"),
            },
            select: { id: true },
          })
        ).id;

      const mkStudent = async (adm: string, first: string) =>
        (
          await db.student.create({
            data: {
              schoolId: schoolA,
              admissionNumber: adm,
              firstName: first,
              lastName: `Res-${runId}`,
              dateOfBirth: new Date("2012-04-01"),
              gender: "FEMALE",
              passwordHash: hash,
              activatedAt: new Date(),
            },
            select: { id: true },
          })
        ).id;

      adaId = await mkStudent(`ADM-ADA-${runId}`, "Ada");
      bolaId = await mkStudent(`ADM-BOLA-${runId}`, "Bola");

      const mkGuardian = async (first: string, phone: string) =>
        (
          await db.guardian.create({
            data: {
              schoolId: schoolA,
              firstName: first,
              lastName: `G-${runId}`,
              relationship: "MOTHER",
              phone,
              email: `${first.toLowerCase()}-${runId}@example.test`,
            },
            select: { id: true },
          })
        ).id;
      adaGuardianId = await mkGuardian("Adaparent", `+23480111${runId}`);
      bolaGuardianId = await mkGuardian("Bolaparent", `+23480222${runId}`);

      await db.studentGuardian.createMany({
        data: [
          { schoolId: schoolA, studentId: adaId, guardianId: adaGuardianId, isPrimary: true },
          { schoolId: schoolA, studentId: bolaId, guardianId: bolaGuardianId, isPrimary: true },
        ],
      });

      const mkCard = async (studentId: string, termId: string, status: ReportCardStatus) => {
        await db.reportCard.create({
          data: {
            schoolId: schoolA,
            studentId,
            termId,
            academicYearId: year.id,
            classArmId: arm.id,
            status,
            overallTotal: 420,
            overallAverage: 8400,
            overallPosition: 2,
            subjectsCount: 5,
            formTeacherComment: "A good term.",
            principalNote: "Well done to the whole class.",
            ...(status === "RELEASED" ? { releasedAt: new Date() } : {}),
          },
        });
      };

      releasedTermId = await mkTerm(`First ${runId}`);
      await mkCard(adaId, releasedTermId, "RELEASED");

      for (const status of UNRELEASED) {
        const t = await mkTerm(`${status} ${runId}`);
        unreleasedTermIds[status] = t;
        await mkCard(adaId, t, status);
      }

      // Bola has a RELEASED card in the same term — so a cross-family leak
      // would return real data rather than an empty list, which is what makes
      // case 2 meaningful.
      await mkCard(bolaId, releasedTermId, "RELEASED");
    });

    let chiGuardianId = "";
    await withTenant(schoolB, async (db) => {
      chiId = (
        await db.student.create({
          data: {
            schoolId: schoolB,
            admissionNumber: `ADM-CHI-${runId}`,
            firstName: "Chi",
            lastName: `Res-${runId}`,
            dateOfBirth: new Date("2012-04-01"),
            gender: "MALE",
            passwordHash: hash,
            activatedAt: new Date(),
          },
          select: { id: true },
        })
      ).id;
      chiGuardianId = (
        await db.guardian.create({
          data: {
            schoolId: schoolB,
            firstName: "Chiparent",
            lastName: `G-${runId}`,
            relationship: "FATHER",
            phone: `+23480333${runId}`,
            email: `chi-${runId}@example.test`,
          },
          select: { id: true },
        })
      ).id;
      await db.studentGuardian.create({
        data: { schoolId: schoolB, studentId: chiId, guardianId: chiGuardianId, isPrimary: true },
      });
    });

    // Sessions minted outside withTenant — nesting takes a second connection
    // with no GUC and RLS correctly rejects the insert.
    adaToken = (await createStudentSession(schoolA, adaId, { ipAddress: null, userAgent: null })).rawToken;
    chiToken = (await createStudentSession(schoolB, chiId, { ipAddress: null, userAgent: null })).rawToken;
    adaGuardianToken = (
      await createGuardianSession(schoolA, adaGuardianId, { ipAddress: null, userAgent: null })
    ).rawToken;
    bolaGuardianToken = (
      await createGuardianSession(schoolA, bolaGuardianId, { ipAddress: null, userAgent: null })
    ).rawToken;
  });

  afterAll(async () => {
    for (const id of schoolIds) {
      await withTenant(id, async (db) => {
        await db.studentSession.deleteMany({});
        await db.guardianSession.deleteMany({});
        await db.auditLog.deleteMany({});
        await db.reportCard.deleteMany({});
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
  });

  const asStudent = (token: string, path: string) =>
    http.get(`/api/v1/student-portal${path}`).set("Authorization", `Bearer ${token}`);
  const asGuardian = (token: string, path: string) =>
    http.get(`/api/v1/portal${path}`).set("Authorization", `Bearer ${token}`);

  // ----------------------------------------------------------------- 1 --
  it("1. CONTROL — a student CAN read their own RELEASED card", async () => {
    // Without this, every refusal below would pass just as happily if the
    // endpoint were broken for everyone.
    const res = await asStudent(adaToken, `/me/results/${releasedTermId}`);
    expect(res.status).toBe(200);
    expect(res.body.student.id).toBe(adaId);
    expect(res.body.overallAverage).toBe(8400);
  });

  it.each(UNRELEASED)("1%s. a student CANNOT read a card in %s", async (status) => {
    const res = await asStudent(adaToken, `/me/results/${unreleasedTermIds[status]}`);
    expect(res.status).toBe(404);
  });

  it("1e. the list contains ONLY the released term", async () => {
    const res = await asStudent(adaToken, "/me/results");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].termId).toBe(releasedTermId);
  });

  // ----------------------------------------------------------------- 2 --
  it("2. a student's list never contains another family's child, same school", async () => {
    const res = await asStudent(adaToken, "/me/results");
    expect(res.status).toBe(200);
    // Bola has a RELEASED card in the same term; the only thing keeping it out
    // is the studentId coming from the session.
    const ids: string[] = res.body.data.map((r: { reportCardId: string }) => r.reportCardId);
    expect(new Set(ids).size).toBe(ids.length);
    const detail = await asStudent(adaToken, `/me/results/${releasedTermId}`);
    expect(detail.body.student.id).toBe(adaId);
    expect(detail.body.student.id).not.toBe(bolaId);
  });

  // ----------------------------------------------------------------- 3 --
  it("3. a student from another SCHOOL sees nothing of school A", async () => {
    const res = await asStudent(chiToken, "/me/results");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);

    // And the same term id, which exists in school A, is invisible from B.
    const detail = await asStudent(chiToken, `/me/results/${releasedTermId}`);
    expect(detail.status).toBe(404);
  });

  // ----------------------------------------------------------------- 4 --
  it("4. a guardian sees EXACTLY what their child sees", async () => {
    // Asserted as one equality rather than two parallel assertions, which
    // could drift apart without failing.
    const child = await asStudent(adaToken, `/me/results/${releasedTermId}`);
    const parent = await asGuardian(adaGuardianToken, `/students/${adaId}/results/${releasedTermId}`);
    expect(child.status).toBe(200);
    expect(parent.status).toBe(200);
    expect(parent.body).toEqual(child.body);

    const childList = await asStudent(adaToken, "/me/results");
    const parentList = await asGuardian(adaGuardianToken, `/students/${adaId}/results`);
    expect(parentList.body).toEqual(childList.body);
  });

  it("4b. a guardian is refused the unreleased terms too", async () => {
    for (const status of UNRELEASED) {
      const res = await asGuardian(
        adaGuardianToken,
        `/students/${adaId}/results/${unreleasedTermIds[status]}`,
      );
      expect(res.status).toBe(404);
    }
  });

  // ----------------------------------------------------------------- 5 --
  it("5. a guardian CANNOT read a child they are not linked to (403, not 404)", async () => {
    const res = await asGuardian(bolaGuardianToken, `/students/${adaId}/results`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_LINKED_TO_STUDENT");

    const detail = await asGuardian(
      bolaGuardianToken,
      `/students/${adaId}/results/${releasedTermId}`,
    );
    expect(detail.status).toBe(403);
  });

  it("5b. an unknown student is 404, keeping the two modes distinguishable", async () => {
    const res = await asGuardian(
      adaGuardianToken,
      "/students/00000000-0000-4000-8000-000000000000/results",
    );
    expect(res.status).toBe(404);
  });

  it("5c. a guardian in ANOTHER school gets 404, not 403 — the child is tenant-invisible", async () => {
    // Different from 5: there the student exists and the link does not. Here
    // RLS hides the row entirely, so "not found" is the honest answer and
    // revealing 403 would confirm the id exists in some other school.
    const res = await asGuardian(adaGuardianToken, `/students/${chiId}/results`);
    expect(res.status).toBe(404);
  });

  // ----------------------------------------------------------------- 6 --
  it("6. a GRADUATED student can still read their released results", async () => {
    // The direct payoff of PR #183 — and the case that proves that fix was
    // worth making rather than merely defensible.
    await withTenant(schoolA, async (db) => {
      await db.student.update({ where: { id: adaId }, data: { status: "GRADUATED" } });
    });
    const res = await asStudent(adaToken, `/me/results/${releasedTermId}`);
    expect(res.status).toBe(200);
    expect(res.body.student.id).toBe(adaId);

    await withTenant(schoolA, async (db) => {
      await db.student.update({ where: { id: adaId }, data: { status: "ACTIVE" } });
    });
  });

  // ----------------------------------------------------------------- 7 --
  it("7. positions are withheld from both principals while the school switch is missing", async () => {
    // The card carries overallPosition = 2. Both surfaces must return null
    // while FAMILY_VISIBLE_POSITION is false — and, critically, must return
    // the SAME thing, so the flag cannot be flipped for one principal only.
    expect(FAMILY_VISIBLE_POSITION).toBe(false);
    const child = await asStudent(adaToken, `/me/results/${releasedTermId}`);
    const parent = await asGuardian(adaGuardianToken, `/students/${adaId}/results/${releasedTermId}`);
    expect(child.body.overallPosition).toBeNull();
    expect(parent.body.overallPosition).toBeNull();
  });

  it("8. the family payload omits the staff-only and PII fields", async () => {
    const res = await asStudent(adaToken, `/me/results/${releasedTermId}`);
    const body = JSON.stringify(res.body);
    for (const banned of [
      "principalNote", // per-arm remark, not about this child
      "pdfStatus",
      "artifactUrl",
      "dateOfBirth",
      "gender",
      "photoUrl",
    ]) {
      expect(body, `payload leaked ${banned}`).not.toContain(banned);
    }
  });
});
