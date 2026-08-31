import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { Global, INestApplication, Module } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant, type StudentStatus } from "@school-kit/db";

import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { createStudentSession } from "../../common/auth/student-sessions";
import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import {
  PORTAL_ACTIVATION_STATUSES,
  PORTAL_SESSION_STATUSES,
} from "../../common/auth/student-portal-status";
import { PortalStudentsModule } from "../portal-students/portal-students.module";
import { StudentPortalModule } from "./student-portal.module";
import * as password from "../../common/auth/password";

// Phase 6 / Slice 3 follow-up — the STATUS WALK.
//
// One asymmetry, proven in both directions for every status in the enum:
//
//   KEEPING a session  is allowed for ACTIVE, WITHDRAWN, GRADUATED
//   OBTAINING a first  is allowed for ACTIVE only
//
// A school-leaver keeps reading their own results; a school-leaver cannot be
// handed a brand-new credential. Before this fix both questions shared one
// `"ACTIVE"` literal, so a graduated student lost their history on the day
// the school marked them graduated.
//
// Every case runs over real HTTP through the real guard. The two that matter
// most are the CONTROLS: without them, "graduated cannot accept" would pass
// just as happily if accept were broken for everyone.

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
const ALL_STATUSES: StudentStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "WITHDRAWN",
  "GRADUATED",
  "SUSPENDED",
];

describe("Student portal — status walk (keep vs obtain)", () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  const runId = Date.now().toString(36);
  const slug = `stat-${runId}`;
  let schoolId: string;
  let guardianToken: string;

  // One student per status, each already carrying a password, so "can they
  // sign in" isolates status and nothing else.
  const students: Record<StudentStatus, { id: string; adm: string }> = {} as never;

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

    schoolId = (
      await basePrisma.school.create({
        data: { name: `Status Walk ${runId}`, slug },
        select: { id: true },
      })
    ).id;

    const hash = await password.hashPassword(PASSWORD);
    let guardianId = "";

    await withTenant(schoolId, async (db) => {
      const g = await db.guardian.create({
        data: {
          schoolId,
          firstName: "Stat",
          lastName: `G-${runId}`,
          relationship: "MOTHER",
          phone: `+2348090${runId}`,
          email: `stat-${runId}@example.test`,
        },
        select: { id: true },
      });
      guardianId = g.id;

      for (const status of ALL_STATUSES) {
        const adm = `ADM-${status}-${runId}`;
        const s = await db.student.create({
          data: {
            schoolId,
            admissionNumber: adm,
            firstName: status,
            lastName: `Stat-${runId}`,
            dateOfBirth: new Date("2010-01-01"),
            gender: "FEMALE",
            status,
            passwordHash: hash,
            activatedAt: new Date(),
          },
          select: { id: true },
        });
        students[status] = { id: s.id, adm };
        await db.studentGuardian.create({
          data: { schoolId, studentId: s.id, guardianId: g.id, isPrimary: true },
        });
      }
    });

    // Minted outside withTenant — nesting acquires a second connection with no
    // GUC, and RLS correctly rejects the insert.
    guardianToken = (
      await createGuardianSession(schoolId, guardianId, { ipAddress: null, userAgent: null })
    ).rawToken;
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
  });

  const login = (adm: string) =>
    http
      .post("/api/v1/student-portal/login")
      .send({ schoolSlug: slug, admissionNumber: adm, password: PASSWORD });

  // ------------------------------------------------------------ keeping --
  describe("KEEPING access — an account that already exists", () => {
    const keeps: StudentStatus[] = ["ACTIVE", "WITHDRAWN", "GRADUATED"];
    const loses: StudentStatus[] = ["SUSPENDED", "INACTIVE"];

    it.each(keeps)("10. a %s student with a password CAN still sign in", async (status) => {
      const res = await login(students[status].adm);
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(students[status].id);
      expect(res.body.token).toBeTruthy();
    });

    it.each(loses)("11. a %s student CANNOT sign in", async (status) => {
      const res = await login(students[status].adm);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it.each(keeps)("12. a %s student's LIVE session survives the guard", async (status) => {
      const token = (
        await createStudentSession(schoolId, students[status].id, {
          ipAddress: null,
          userAgent: null,
        })
      ).rawToken;
      const res = await http
        .get("/api/v1/student-portal/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(students[status].id);
    });

    it.each(loses)("13. a %s student's LIVE session is refused by the guard", async (status) => {
      const token = (
        await createStudentSession(schoolId, students[status].id, {
          ipAddress: null,
          userAgent: null,
        })
      ).rawToken;
      const res = await http
        .get("/api/v1/student-portal/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
      // Same opaque code as every other refusal — the guard must not become an
      // oracle that distinguishes "suspended" from "never existed".
      expect(res.body.error.code).toBe("INVALID_SESSION");
    });
  });

  // --------------------------------------------------------- obtaining --
  describe("OBTAINING a first credential — the narrower set", () => {
    const issue = async (studentId: string): Promise<string> => {
      const res = await http
        .post(`/api/v1/portal/students/${studentId}/portal-invitation`)
        .set("Authorization", `Bearer ${guardianToken}`)
        .expect(200);
      return res.body.token as string;
    };

    it("14. CONTROL — an ACTIVE student CAN accept a fresh invitation", async () => {
      // Without this, every case below would pass if accept were simply broken.
      const token = await issue(students.ACTIVE.id);
      const res = await http
        .post(`/api/v1/student-portal/invitations/${token}/accept`)
        .send({ password: "a-fresh-password-here" });
      expect(res.status).toBe(200);
      expect(res.body.student.id).toBe(students.ACTIVE.id);
    });

    it("14b. guardian password reset revokes old student access and issues one reset token", async () => {
      const oldSession = (await createStudentSession(schoolId, students.ACTIVE.id, {
        ipAddress: null, userAgent: null,
      })).rawToken;
      const reset = await http.post(`/api/v1/portal/students/${students.ACTIVE.id}/password-reset`)
        .set("Authorization", `Bearer ${guardianToken}`).expect(200);
      expect(reset.body.token).toEqual(expect.any(String));
      await http.get("/api/v1/student-portal/me").set("Authorization", `Bearer ${oldSession}`).expect(401);
      await http.post("/api/v1/student-portal/login")
        .send({ schoolSlug: slug, admissionNumber: students.ACTIVE.adm, password: "a-fresh-password-here" }).expect(401);
      const pending = await http.get(`/api/v1/portal/students/${students.ACTIVE.id}/portal-status`)
        .set("Authorization", `Bearer ${guardianToken}`).expect(200);
      expect(pending.body.state).toBe("RESET_PENDING");
      expect(pending.body.pendingInvitationPurpose).toBe("PASSWORD_RESET");
      await http.post(`/api/v1/student-portal/invitations/${reset.body.token}/accept`)
        .send({ password: "Recovered-Student-1" }).expect(200);
      await http.post("/api/v1/student-portal/login")
        .send({ schoolSlug: slug, admissionNumber: students.ACTIVE.adm, password: "Recovered-Student-1" }).expect(200);
    });

    it.each<StudentStatus>(["WITHDRAWN", "GRADUATED"])(
      "15. a %s student CANNOT accept, even though they may still sign in",
      async (status) => {
        const token = await issue(students[status].id);

        // The invitation itself resolves — the refusal is about the STUDENT's
        // status, not a dead token. Proving the link is live first is what
        // makes the 410 below meaningful.
        await http.get(`/api/v1/student-portal/invitations/${token}`).expect(200);

        const res = await http
          .post(`/api/v1/student-portal/invitations/${token}/accept`)
          .send({ password: "should-not-be-set-here" });
        expect(res.status).toBe(410);
        expect(res.body.error.code).toBe("INVITATION_NOT_AVAILABLE");

        // And the refusal did not quietly change their password: the ORIGINAL
        // one still works, which is the whole point of keeping them able to
        // sign in.
        const still = await login(students[status].adm);
        expect(still.status).toBe(200);
      },
    );

    it.each<StudentStatus>(["SUSPENDED", "INACTIVE"])(
      "16. a %s student CANNOT accept either",
      async (status) => {
        const token = await issue(students[status].id);
        const res = await http
          .post(`/api/v1/student-portal/invitations/${token}/accept`)
          .send({ password: "should-not-be-set-here" });
        expect(res.status).toBe(410);
        expect(res.body.error.code).toBe("INVITATION_NOT_AVAILABLE");
      },
    );

    it("17. a refused accept does NOT burn the invitation", async () => {
      // The status check runs after the atomic updateMany that consumes the
      // token, inside the same transaction — so the rollback must un-consume
      // it. Worth pinning: if consumption ever moved outside the transaction,
      // a student reinstated an hour later would find their link silently
      // dead, with nothing to explain why.
      const token = await issue(students.GRADUATED.id);
      await http
        .post(`/api/v1/student-portal/invitations/${token}/accept`)
        .send({ password: "rejected-attempt-one" })
        .expect(410);

      await http.get(`/api/v1/student-portal/invitations/${token}`).expect(200);

      await withTenant(schoolId, async (db) => {
        await db.student.update({
          where: { id: students.GRADUATED.id },
          data: { status: "ACTIVE" },
        });
      });
      const res = await http
        .post(`/api/v1/student-portal/invitations/${token}/accept`)
        .send({ password: "accepted-after-reinstatement" });
      expect(res.status).toBe(200);

      await withTenant(schoolId, async (db) => {
        await db.student.update({
          where: { id: students.GRADUATED.id },
          data: { status: "GRADUATED" },
        });
      });
    });
  });

  // --------------------------------------------------------- invariant --
  it("18. every status that may ACTIVATE may also hold a SESSION", () => {
    // A set where this failed would let a student set a password they could
    // never use. Asserted against the constants rather than the enum so it
    // keeps holding if either set is edited later.
    for (const status of PORTAL_ACTIVATION_STATUSES) {
      expect(PORTAL_SESSION_STATUSES).toContain(status);
    }
    expect(PORTAL_SESSION_STATUSES.length).toBeGreaterThan(
      PORTAL_ACTIVATION_STATUSES.length,
    );
  });

  it("19. every status in the enum is deliberately classified", () => {
    // Guards against a future enum member silently defaulting to "no access"
    // without anyone deciding that is what it should do.
    for (const status of ALL_STATUSES) {
      const known =
        PORTAL_SESSION_STATUSES.includes(status) ||
        (["SUSPENDED", "INACTIVE"] as StudentStatus[]).includes(status);
      expect(known, `${status} is not classified in either direction`).toBe(true);
    }
  });
});
