import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { Global, INestApplication, Module } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant } from "@school-kit/db";

import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { createStudentSession } from "../../common/auth/student-sessions";
import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { PortalStudentsModule } from "../portal-students/portal-students.module";
import { StudentPortalModule } from "./student-portal.module";
import * as password from "../../common/auth/password";

// Phase 6 / Slice 3 — the NEGATIVE WALK.
//
// Real HTTP through the real guards against a real database. The point of
// this file is not that the happy path works; it is that every WRONG answer
// is actually refused, and refused with the RIGHT status.
//
// Three properties this suite exists to hold, all of which passed a
// structural review and could still have been wrong:
//
//   1. Cross-FAMILY isolation. Two students, one school, different families.
//      Every tenant boundary is satisfied, so RLS does not help — it was
//      measured doing nothing here (D27). Only the service check stands
//      between them.
//   2. 403 vs 404. "Not linked" and "does not exist" both produce rowCount 0
//      if the check is folded into the write's WHERE clause, and they are
//      different answers. D27 requires distinct, raised errors.
//   3. Burn-then-replay. Deactivation must make the OLD tokens unusable
//      through the real authentication path, not merely change a column.

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

const PASSWORD = "correct-horse-battery";

describe("Student portal — negative walk (Phase 6 / Slice 3)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const schoolIds = new Set<string>();
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  let schoolA: string;
  let schoolB: string;
  let slugA: string;
  let slugB: string;

  // School A, family 1: guardian G1 with children S1 and S1b (siblings).
  // School A, family 2: guardian G2 with child S2.
  // School B: guardian G3 with child S3.
  let g1Token: string;
  let g2Token: string;
  let g3Token: string;
  let s1: string;
  let s1b: string;
  let s2: string;
  let s3: string;
  let admS1: string;
  let admS2: string;

  let s1Token: string; // a live student session for S1
  let s1bToken: string; // a live student session for the sibling
  let g1Id: string;
  let g2Id: string;
  let g3Id: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MockRedisAuthModule,
        PortalStudentsModule,
        StudentPortalModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = request(app.getHttpServer());

    slugA = `swalk-a-${runId}`;
    slugB = `swalk-b-${runId}`;
    schoolA = (
      await basePrisma.school.create({
        data: { name: `Student Walk A ${runId}`, slug: slugA },
        select: { id: true },
      })
    ).id;
    schoolB = (
      await basePrisma.school.create({
        data: { name: `Student Walk B ${runId}`, slug: slugB },
        select: { id: true },
      })
    ).id;
    schoolIds.add(schoolA);
    schoolIds.add(schoolB);

    const hash = await password.hashPassword(PASSWORD);
    admS1 = `ADM-S1-${runId}`;
    admS2 = `ADM-S2-${runId}`;

    await withTenant(schoolA, async (db) => {
      const g1 = await db.guardian.create({
        data: {
          schoolId: schoolA, firstName: "Fam1", lastName: `G1-${runId}`,
          relationship: "MOTHER", phone: `+2348010${runId}`,
          email: `g1-${runId}@example.test`,
        },
        select: { id: true },
      });
      const g2 = await db.guardian.create({
        data: {
          schoolId: schoolA, firstName: "Fam2", lastName: `G2-${runId}`,
          relationship: "FATHER", phone: `+2348020${runId}`,
          email: `g2-${runId}@example.test`,
        },
        select: { id: true },
      });

      // S1 and S1b are SIBLINGS — same guardian, same school. This is the
      // case most likely to look correct while being wrong, because every
      // boundary except "which student is this session for" is satisfied.
      const mk = async (adm: string, first: string, activated: boolean) =>
        (
          await db.student.create({
            data: {
              schoolId: schoolA, admissionNumber: adm, firstName: first,
              lastName: `Walk-${runId}`, dateOfBirth: new Date("2013-01-01"),
              gender: "FEMALE",
              ...(activated ? { passwordHash: hash, activatedAt: new Date() } : {}),
            },
            select: { id: true },
          })
        ).id;

      s1 = await mk(admS1, "Sone", true);
      s1b = await mk(`ADM-S1B-${runId}`, "Sib", true);
      s2 = await mk(admS2, "Stwo", true);

      await db.studentGuardian.createMany({
        data: [
          { schoolId: schoolA, studentId: s1, guardianId: g1.id, isPrimary: true },
          { schoolId: schoolA, studentId: s1b, guardianId: g1.id, isPrimary: true },
          { schoolId: schoolA, studentId: s2, guardianId: g2.id, isPrimary: true },
        ],
      });

      g1Id = g1.id;
      g2Id = g2.id;
    });

    await withTenant(schoolB, async (db) => {
      const g3 = await db.guardian.create({
        data: {
          schoolId: schoolB, firstName: "Fam3", lastName: `G3-${runId}`,
          relationship: "MOTHER", phone: `+2348030${runId}`,
          email: `g3-${runId}@example.test`,
        },
        select: { id: true },
      });
      s3 = (
        await db.student.create({
          data: {
            schoolId: schoolB, admissionNumber: admS1, // SAME admission number as S1
            firstName: "Sthree", lastName: `Walk-${runId}`,
            dateOfBirth: new Date("2013-01-01"), gender: "MALE",
            passwordHash: hash, activatedAt: new Date(),
          },
          select: { id: true },
        })
      ).id;
      await db.studentGuardian.create({
        data: { schoolId: schoolB, studentId: s3, guardianId: g3.id, isPrimary: true },
      });
      g3Id = g3.id;
    });

    // Session minting happens OUTSIDE the withTenant blocks above.
    // createGuardianSession/createStudentSession open their own withTenant
    // transaction; nesting one inside another acquires a second connection
    // whose GUC is unset, so the RLS policy correctly rejects the insert.
    // Cheap to trip over, and the error names the policy rather than the
    // nesting, so it is worth stating plainly.
    g1Token = (await createGuardianSession(schoolA, g1Id, { ipAddress: null, userAgent: null })).rawToken;
    g2Token = (await createGuardianSession(schoolA, g2Id, { ipAddress: null, userAgent: null })).rawToken;
    g3Token = (await createGuardianSession(schoolB, g3Id, { ipAddress: null, userAgent: null })).rawToken;

    s1Token = (await createStudentSession(schoolA, s1, { ipAddress: null, userAgent: null })).rawToken;
    s1bToken = (await createStudentSession(schoolA, s1b, { ipAddress: null, userAgent: null })).rawToken;
  });

  afterAll(async () => {
    for (const id of schoolIds) {
      await withTenant(id, async (db) => {
        await db.studentSession.deleteMany({});
        await db.studentPortalInvitation.deleteMany({});
        await db.auditLog.deleteMany({});
        await db.studentGuardian.deleteMany({});
        await db.guardianSession.deleteMany({});
        await db.student.deleteMany({});
        await db.guardian.deleteMany({});
      });
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  // ---------------------------------------------------------------- 1-3 --
  describe("cross-family and cross-tenant isolation", () => {
    it("1. a student's session returns THEIR OWN record, never a sibling's", async () => {
      const res = await http
        .get("/api/v1/student-portal/me")
        .set("Authorization", `Bearer ${s1Token}`)
        .expect(200);

      expect(res.body.student.id).toBe(s1);
      expect(res.body.student.id).not.toBe(s1b);
      expect(res.body.student.admissionNumber).toBe(admS1);

      // And the sibling's token returns the sibling — proving the two
      // sessions genuinely resolve to different subjects rather than both
      // happening to return the first row.
      const sib = await http
        .get("/api/v1/student-portal/me")
        .set("Authorization", `Bearer ${s1bToken}`)
        .expect(200);
      expect(sib.body.student.id).toBe(s1b);
    });

    it("2. a guardian CANNOT act on another family's child in the SAME school (403, not 404)", async () => {
      // G2 is a real, authenticated guardian in the same school. S1 is a real
      // student in that school. Every tenant boundary is satisfied — RLS
      // permits this write, and only D27's check refuses it.
      for (const path of ["portal-status", "portal-invitation", "deactivate"]) {
        const method = path === "portal-status" ? "get" : "post";
        const res = await http[method](`/api/v1/portal/students/${s1}/${path}`)
          .set("Authorization", `Bearer ${g2Token}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("NOT_LINKED_TO_STUDENT");
      }
    });

    it("3. a guardian CANNOT act on a child in a DIFFERENT school (404, tenant-invisible)", async () => {
      // G3 is in school B; S1 is in school A. RLS hides the row entirely, so
      // the honest answer is "no such student" — the student is not merely
      // off-limits, it is not in this tenant at all.
      const res = await http
        .post(`/api/v1/portal/students/${s1}/deactivate`)
        .set("Authorization", `Bearer ${g3Token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // ------------------------------------------------------------------ 4 --
  it("4. a non-existent student id is 404, distinguishable from the 403 above", async () => {
    // The whole point of D27: fold the check into the write's WHERE clause
    // and BOTH of these are rowCount 0. They must not collapse into one answer.
    const res = await http
      .post(`/api/v1/portal/students/00000000-0000-4000-8000-000000000000/deactivate`)
      .set("Authorization", `Bearer ${g1Token}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  // ------------------------------------------------------------------ 5 --
  it("5. login is single-row across schools sharing an admission number", async () => {
    // S1 (school A) and S3 (school B) have the SAME admission number. The
    // school slug must be what disambiguates them — and each must resolve to
    // its own student, not merely to "a" student.
    const a = await http
      .post("/api/v1/student-portal/login")
      .send({ schoolSlug: slugA, admissionNumber: admS1, password: PASSWORD })
      .expect(200);
    expect(a.body.student.id).toBe(s1);
    expect(a.body.school.slug).toBe(slugA);

    const b = await http
      .post("/api/v1/student-portal/login")
      .send({ schoolSlug: slugB, admissionNumber: admS1, password: PASSWORD })
      .expect(200);
    expect(b.body.student.id).toBe(s3);
    expect(b.body.school.slug).toBe(slugB);
  });

  // ------------------------------------------------------------------ 6 --
  it("6. every login failure returns an IDENTICAL body, whatever the cause", async () => {
    // This is the enumeration defence. Admission numbers are sequential and
    // school slugs are public, so any difference between these responses
    // turns the endpoint into a roster oracle.
    const cases: Array<[string, Record<string, string>]> = [
      ["unknown school", { schoolSlug: `no-such-${runId}`, admissionNumber: admS1, password: PASSWORD }],
      ["unknown admission", { schoolSlug: slugA, admissionNumber: `NOPE-${runId}`, password: PASSWORD }],
      ["wrong password", { schoolSlug: slugA, admissionNumber: admS1, password: "wrong-password-here" }],
    ];

    const bodies: string[] = [];
    for (const [, payload] of cases) {
      const res = await http.post("/api/v1/student-portal/login").send(payload).expect(401);
      bodies.push(JSON.stringify(res.body));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("6b. a failed login against a REAL student writes an audit row", async () => {
    // The enumeration defence is only useful if it is DETECTABLE. This was
    // silently broken on first implementation — the tenant was not passed
    // through for a student that exists but has no credential, so the exact
    // case a school most needs to see wrote nothing. Found by reading the
    // audit table after the walkthrough, so it is asserted here now.
    await http
      .post("/api/v1/student-portal/login")
      .send({ schoolSlug: slugA, admissionNumber: admS1, password: "definitely-wrong" })
      .expect(401);

    const rows = await withTenant(schoolA, (db) =>
      db.auditLog.findMany({
        where: { action: "student.login-failed", entityId: s1 },
        select: { metadata: true },
      }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rows[0]!.metadata)).toContain(admS1);
  });

  // ---------------------------------------------------------------- 7-9 --
  describe("burn-then-replay — the full-stack proof", () => {
    it("7. a deactivated student's LIVE session dies on the very next request", async () => {
      const live = (await createStudentSession(schoolA, s2, { ipAddress: null, userAgent: null })).rawToken;

      // Works before.
      await http.get("/api/v1/student-portal/me").set("Authorization", `Bearer ${live}`).expect(200);

      const deact = await http
        .post(`/api/v1/portal/students/${s2}/deactivate`)
        .set("Authorization", `Bearer ${g2Token}`)
        .expect(200);
      expect(deact.body.state).toBe("DEACTIVATED");
      expect(deact.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

      // Dead after — through the real guard, not by reading a column.
      const after = await http
        .get("/api/v1/student-portal/me")
        .set("Authorization", `Bearer ${live}`);
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe("INVALID_SESSION");
    });

    it("8. the deactivated student cannot log in again with their OLD password", async () => {
      const res = await http
        .post("/api/v1/student-portal/login")
        .send({ schoolSlug: slugA, admissionNumber: admS2, password: PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("9. a BURNED invitation cannot be replayed; only a fresh one works", async () => {
      // Issue an invitation, then deactivate — which must revoke it. The
      // forwarded-screenshot scenario: someone still holds the old link.
      const issued = await http
        .post(`/api/v1/portal/students/${s1}/portal-invitation`)
        .set("Authorization", `Bearer ${g1Token}`)
        .expect(200);
      const burned = issued.body.token as string;

      await http
        .get(`/api/v1/student-portal/invitations/${burned}`)
        .expect(200); // live right now

      const deact = await http
        .post(`/api/v1/portal/students/${s1}/deactivate`)
        .set("Authorization", `Bearer ${g1Token}`)
        .expect(200);
      expect(deact.body.invitationsRevoked).toBeGreaterThanOrEqual(1);

      // The old link is dead for BOTH reading and accepting. Accepting is the
      // one that matters: if it still worked, the child could set a new
      // password and walk straight back in, which is exactly the "trivial
      // re-scan defeats it" failure this design exists to prevent.
      await http.get(`/api/v1/student-portal/invitations/${burned}`).expect(404);
      const replay = await http
        .post(`/api/v1/student-portal/invitations/${burned}/accept`)
        .send({ password: "a-brand-new-password" });
      expect(replay.status).toBe(404);

      // Only a guardian issuing a FRESH invitation restores access.
      const reissued = await http
        .post(`/api/v1/portal/students/${s1}/portal-invitation`)
        .set("Authorization", `Bearer ${g1Token}`)
        .expect(200);
      const accepted = await http
        .post(`/api/v1/student-portal/invitations/${reissued.body.token}/accept`)
        .send({ password: "a-brand-new-password" })
        .expect(200);
      expect(accepted.body.student.id).toBe(s1);
      expect(accepted.body.token).toBeTruthy();

      // And that new invitation is itself single-use.
      const secondUse = await http
        .post(`/api/v1/student-portal/invitations/${reissued.body.token}/accept`)
        .send({ password: "yet-another-password" });
      expect(secondUse.status).toBe(404);
    });
  });
});
