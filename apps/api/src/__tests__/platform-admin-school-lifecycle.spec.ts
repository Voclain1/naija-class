import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { Controller, Get, Global, INestApplication, Module, UseGuards } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import request from "supertest";

import { applySchoolDefaults, basePrisma, withTenant } from "@school-kit/db";

import { AuthGuard } from "../common/auth/auth.guard";
import { GuardianAuthGuard } from "../common/auth/guardian-auth.guard";
import { createGuardianSession } from "../common/auth/guardian-sessions";
import { REDIS_AUTH_CLIENT } from "../common/auth/redis-auth.provider";
import { createSession } from "../common/auth/sessions";
import { StudentAuthGuard } from "../common/auth/student-auth.guard";
import { createStudentSession } from "../common/auth/student-sessions";
import { HttpExceptionFilter } from "../common/http-exception.filter";
import { PlatformAdminModule } from "../modules/platform-admin/platform-admin.module";

// Platform-admin tools, slice 2 — school lifecycle (docs/modules/platform-
// admin.md). Owner's decisions, 2026-10-05: suspend blocks every sign-in and
// ends live sessions; delete only a school that never recorded a payment,
// after the operator types its slug.

// No session cache: every probe below re-reads the resolver, which is what
// "ends at the next request" means once the 30-second cache has turned over.
@Global()
@Module({
  providers: [{ provide: REDIS_AUTH_CLIENT, useValue: { get: async () => null, set: async () => "OK", del: async () => 1 } }],
  exports: [REDIS_AUTH_CLIENT],
})
class InertRedisAuthModule {}

// One route behind each principal's guard — the guards are what is under test.
@Controller("probe")
class ProbeController {
  @Get("staff")
  @UseGuards(AuthGuard)
  staff() {
    return { ok: true };
  }
  @Get("guardian")
  @UseGuards(GuardianAuthGuard)
  guardian() {
    return { ok: true };
  }
  @Get("student")
  @UseGuards(StudentAuthGuard)
  student() {
    return { ok: true };
  }
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "lifecycle-spec" };

describe("Platform admin — school lifecycle (2026-10-07)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const schoolIds = new Set<string>();
  let app: INestApplication;
  let hostSchoolId: string;
  let platformAdminUserId: string;
  let paToken: string;

  async function makeSchool(label: string) {
    const school = await basePrisma.school.create({
      data: { name: `Lifecycle ${label} ${runId}`, slug: `lifecycle-${label}-${runId}`, status: "ACTIVE" },
      select: { id: true, slug: true },
    });
    schoolIds.add(school.id);
    await basePrisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${school.id}, true)`;
        await applySchoolDefaults(tx, school.id);
      },
      { timeout: 20_000 },
    );
    return school;
  }

  async function makePeople(schoolId: string, label: string, opts: { isPlatformAdmin?: boolean } = {}) {
    return withTenant(schoolId, async (db) => {
      const role = await db.role.findFirstOrThrow({ where: { schoolId: null, key: "owner", isSystem: true } });
      const user = await db.user.create({
        data: {
          schoolId,
          firstName: "Owner",
          lastName: label,
          email: `owner-${label}-${runId}@example.test`,
          phone: `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
          passwordHash: "argon2id$placeholder",
          isPlatformAdmin: opts.isPlatformAdmin ?? false,
        },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `LC-${label}-${runId}`,
          firstName: "Student",
          lastName: label,
          dateOfBirth: new Date("2013-03-01"),
          gender: "MALE",
        },
      });
      const guardian = await db.guardian.create({
        data: { schoolId, firstName: "Parent", lastName: label, relationship: "MOTHER", phone: "+2348011112222" },
      });
      return { userId: user.id, studentId: student.id, guardianId: guardian.id };
    });
  }

  const pa = (method: "get" | "post", path: string) =>
    request(app.getHttpServer())[method](`/api/v1/platform-admin/${path}`).set("Authorization", `Bearer ${paToken}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), InertRedisAuthModule, PlatformAdminModule],
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const host = await makeSchool("host");
    hostSchoolId = host.id;
    platformAdminUserId = (await makePeople(host.id, "host", { isPlatformAdmin: true })).userId;
    paToken = (await createSession(host.id, platformAdminUserId, reqCtx)).rawToken;
  });

  afterAll(async () => {
    await basePrisma.auditLog.deleteMany({ where: { userId: platformAdminUserId } });
    for (const id of schoolIds) {
      const exists = await basePrisma.school.findUnique({ where: { id } });
      if (!exists) continue;
      await basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
        const { deleteSchoolRows } = await import("../modules/platform-admin/school-deletion");
        await deleteSchoolRows(tx, id);
      }, { timeout: 60_000 });
    }
    await app.close();
    await basePrisma.$disconnect();
  });

  describe("suspend and reactivate", () => {
    let school: { id: string; slug: string };
    let people: { userId: string; studentId: string; guardianId: string };
    let tokens: { staff: string; guardian: string; student: string };

    const probe = (who: "staff" | "guardian" | "student") =>
      request(app.getHttpServer()).get(`/api/v1/probe/${who}`).set("Authorization", `Bearer ${tokens[who]}`);

    beforeAll(async () => {
      school = await makeSchool("suspend");
      people = await makePeople(school.id, "suspend");
      await withTenant(school.id, (db) =>
        db.student.update({ where: { id: people.studentId }, data: { passwordHash: "argon2id$placeholder" } }),
      );
      tokens = {
        staff: (await createSession(school.id, people.userId, reqCtx)).rawToken,
        guardian: (await createGuardianSession(school.id, people.guardianId, reqCtx)).rawToken,
        student: (await createStudentSession(school.id, people.studentId, reqCtx)).rawToken,
      };
    });

    it("all three kinds of session work before the suspension", async () => {
      for (const who of ["staff", "guardian", "student"] as const) expect((await probe(who)).status, who).toBe(200);
    });

    it("an ordinary staff session cannot suspend, and a reason is required", async () => {
      const forbidden = await request(app.getHttpServer())
        .post(`/api/v1/platform-admin/schools/${school.id}/suspend`)
        .set("Authorization", `Bearer ${tokens.staff}`)
        .send({ reason: "Unpaid subscription" });
      expect(forbidden.status).toBe(403);
      expect((await pa("post", `schools/${school.id}/suspend`).send({})).status).toBe(400);
      expect((await basePrisma.school.findUniqueOrThrow({ where: { id: school.id } })).suspendedAt).toBeNull();
    });

    it("suspending ends every live session at its next request, and refuses new sign-ins", async () => {
      const res = await pa("post", `schools/${school.id}/suspend`).send({ reason: "Unpaid subscription" });
      expect(res.status).toBe(200);
      expect(typeof res.body.suspendedAt).toBe("string");

      for (const who of ["staff", "guardian", "student"] as const) {
        const r = await probe(who);
        expect(r.status, who).toBe(401);
        expect(r.body.error.code, who).toBe("SCHOOL_SUSPENDED");
      }

      // Every sign-in path ends in one of these three.
      await expect(createSession(school.id, people.userId, reqCtx)).rejects.toMatchObject({ code: "SCHOOL_SUSPENDED" });
      await expect(createGuardianSession(school.id, people.guardianId, reqCtx)).rejects.toMatchObject({ code: "SCHOOL_SUSPENDED" });
      await expect(createStudentSession(school.id, people.studentId, reqCtx)).rejects.toMatchObject({ code: "SCHOOL_SUSPENDED" });

      const list = await pa("get", "schools");
      const row = list.body.find((r: { schoolId: string }) => r.schoolId === school.id);
      expect(row.suspendedAt).toBe(res.body.suspendedAt);
    });

    it("another school's sessions are untouched", async () => {
      const hostProbe = await request(app.getHttpServer()).get("/api/v1/probe/staff").set("Authorization", `Bearer ${paToken}`);
      expect(hostProbe.status).toBe(200);
    });

    it("reactivating restores the same sessions, and both changes are audited", async () => {
      const res = await pa("post", `schools/${school.id}/reactivate`);
      expect(res.status).toBe(200);
      expect(res.body.suspendedAt).toBeNull();
      for (const who of ["staff", "guardian", "student"] as const) expect((await probe(who)).status, who).toBe(200);

      const audit = await basePrisma.auditLog.findMany({
        where: { entityId: school.id, action: { in: ["platform_admin.schools.suspend", "platform_admin.schools.reactivate"] } },
        orderBy: { createdAt: "asc" },
        select: { action: true, metadata: true, schoolId: true },
      });
      expect(audit.map((a) => a.action)).toEqual(["platform_admin.schools.suspend", "platform_admin.schools.reactivate"]);
      expect(audit[0]!.metadata).toMatchObject({ reason: "Unpaid subscription" });
      expect(audit.every((a) => a.schoolId === null)).toBe(true);
    });

    it("the school the operator works from cannot be suspended", async () => {
      const res = await pa("post", `schools/${hostSchoolId}/suspend`).send({ reason: "Should be refused" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SCHOOL_HAS_PLATFORM_ADMIN");
    });
  });

  describe("delete", () => {
    // A school with a little of everything — including a FINAL exam paper
    // (frozen by trigger) and rows behind RESTRICT foreign keys (fee items,
    // assessment scores' grading components, an invoice) — so the delete has
    // to get the order right and the freeze has to step aside.
    async function fillSchool(schoolId: string, label: string) {
      const people = await makePeople(schoolId, label);
      await withTenant(schoolId, async (db) => {
        const year = await db.academicYear.create({
          data: { schoolId, label: `2026/2027-${label}`, startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") },
        });
        const term = await db.term.create({
          data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2026-09-01"), endDate: new Date("2026-12-15") },
        });
        const subject = await db.subject.findFirstOrThrow({ where: { schoolId } });
        const level = await db.classLevel.findFirstOrThrow({ where: { schoolId } });
        const question = await db.question.create({
          data: {
            schoolId, subjectId: subject.id, classLevelId: level.id, topic: "Soil", type: "THEORY", text: "Explain erosion.",
            marks: 5, createdBy: people.userId, status: "APPROVED", approvedBy: people.userId, approvedAt: new Date(),
          },
        });
        const paper = await db.examPaper.create({
          data: { schoolId, subjectId: subject.id, classLevelId: level.id, termId: term.id, title: "Exam", durationMinutes: 60, createdBy: people.userId },
        });
        const section = await db.examPaperSection.create({ data: { schoolId, paperId: paper.id, orderIndex: 0, title: "Section A" } });
        await db.examPaperItem.create({ data: { schoolId, paperId: paper.id, sectionId: section.id, questionId: question.id, orderIndex: 0 } });
        await db.examPaper.update({ where: { id: paper.id }, data: { status: "FINAL", finalisedBy: people.userId, finalisedAt: new Date() } });
        const category = await db.feeCategory.create({ data: { schoolId, name: "Tuition", createdBy: people.userId } });
        await db.feeItem.create({ data: { schoolId, categoryId: category.id, name: "Tuition", amount: 5_000_000, createdBy: people.userId } });
        const invoice = await db.invoice.create({
          data: {
            schoolId, studentId: people.studentId, termId: term.id, academicYearId: year.id, items: [],
            totalAmount: 5_000_000, totalDiscount: 0, totalDue: 5_000_000,
          },
        });
        return { invoiceId: invoice.id };
      });
      await createSession(schoolId, people.userId, reqCtx);
      await createGuardianSession(schoolId, people.guardianId, reqCtx);
      return people;
    }

    // Rows left anywhere for the school, read as app_user under its own GUC.
    async function rowsLeft(schoolId: string): Promise<number> {
      return basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
        const tables = await tx.$queryRaw<{ table_name: string }[]>`
          SELECT c.table_name FROM information_schema.columns c
          JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          WHERE c.table_schema = 'public' AND c.column_name = 'school_id'
            AND c.table_name NOT IN (SELECT inhrelid::regclass::text FROM pg_inherits)`;
        let n = 0;
        for (const { table_name } of tables) {
          const [r] = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table_name}" WHERE school_id = $1`, schoolId);
          n += Number(r!.n);
        }
        return n;
      });
    }

    it("the deletion check counts what a delete would remove", async () => {
      const school = await makeSchool("check");
      await fillSchool(school.id, "check");
      const res = await pa("get", `schools/${school.id}/deletion-check`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        schoolId: school.id, slug: school.slug, deletable: true, blockers: [],
        paymentCount: 0, studentCount: 1, staffCount: 1, guardianCount: 1,
      });
    });

    it("refuses a wrong slug and deletes nothing", async () => {
      const school = await makeSchool("slug");
      await fillSchool(school.id, "slug");
      const before = await rowsLeft(school.id);
      const res = await pa("post", `schools/${school.id}/delete`).send({ confirmSlug: `${school.slug}-typo` });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CONFIRM_SLUG_MISMATCH");
      expect(await rowsLeft(school.id)).toBe(before);
    });

    it("deletes every row a never-paid school owns — FINAL exam paper and RESTRICT chains included — and nothing of anyone else's", async () => {
      const keep = await makeSchool("keep");
      const keepPeople = await fillSchool(keep.id, "keep");
      const keepBefore = await rowsLeft(keep.id);

      const doomed = await makeSchool("doomed");
      await fillSchool(doomed.id, "doomed");
      expect(await rowsLeft(doomed.id)).toBeGreaterThan(20);

      const res = await pa("post", `schools/${doomed.id}/delete`).send({ confirmSlug: doomed.slug });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.slug).toBe(doomed.slug);
      expect(res.body.deletedRowCount).toBeGreaterThan(20);

      expect(await basePrisma.school.findUnique({ where: { id: doomed.id } })).toBeNull();
      expect(await rowsLeft(doomed.id)).toBe(0);
      expect(await rowsLeft(keep.id)).toBe(keepBefore);
      expect(await withTenant(keep.id, (db) => db.student.count({ where: { id: keepPeople.studentId } }))).toBe(1);

      const audit = await basePrisma.auditLog.findFirst({
        where: { action: "platform_admin.schools.delete", entityId: doomed.id },
        select: { schoolId: true, metadata: true },
      });
      expect(audit?.schoolId).toBeNull();
      expect(audit?.metadata).toMatchObject({ slug: doomed.slug, studentCount: 1, staffCount: 1, guardianCount: 1 });
    });

    it("a school that has recorded a payment cannot be deleted, even with the right slug", async () => {
      const school = await makeSchool("paid");
      const people = await fillSchool(school.id, "paid");
      await withTenant(school.id, async (db) => {
        const invoice = await db.invoice.findFirstOrThrow({ where: { schoolId: school.id } });
        await db.payment.create({ data: { schoolId: school.id, invoiceId: invoice.id, studentId: people.studentId, amount: 100_000, method: "CASH" } });
      });
      const check = await pa("get", `schools/${school.id}/deletion-check`);
      expect(check.body).toMatchObject({ deletable: false, blockers: ["HAS_PAYMENTS"], paymentCount: 1 });

      const before = await rowsLeft(school.id);
      const res = await pa("post", `schools/${school.id}/delete`).send({ confirmSlug: school.slug });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SCHOOL_HAS_PAYMENTS");
      expect(await rowsLeft(school.id)).toBe(before);
    });

    it("the school the operator works from cannot be deleted", async () => {
      const host = await basePrisma.school.findUniqueOrThrow({ where: { id: hostSchoolId } });
      const check = await pa("get", `schools/${hostSchoolId}/deletion-check`);
      expect(check.body.blockers).toContain("HAS_PLATFORM_ADMIN");
      const res = await pa("post", `schools/${hostSchoolId}/delete`).send({ confirmSlug: host.slug });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SCHOOL_HAS_PLATFORM_ADMIN");
    });

    it("an ordinary staff session cannot check or delete", async () => {
      const school = await makeSchool("forbidden");
      const people = await makePeople(school.id, "forbidden");
      const token = (await createSession(school.id, people.userId, reqCtx)).rawToken;
      const check = await request(app.getHttpServer())
        .get(`/api/v1/platform-admin/schools/${school.id}/deletion-check`)
        .set("Authorization", `Bearer ${token}`);
      expect(check.status).toBe(403);
      const del = await request(app.getHttpServer())
        .post(`/api/v1/platform-admin/schools/${school.id}/delete`)
        .set("Authorization", `Bearer ${token}`)
        .send({ confirmSlug: school.slug });
      expect(del.status).toBe(403);
      expect(await basePrisma.school.findUnique({ where: { id: school.id } })).not.toBeNull();
    });
  });

  describe("audit log (slice 3)", () => {
    const log = (qs = "") => pa("get", `audit-log${qs}`);

    it("an ordinary staff session cannot read it", async () => {
      const school = await makeSchool("audit-forbidden");
      const people = await makePeople(school.id, "audit-forbidden");
      const token = (await createSession(school.id, people.userId, reqCtx)).rawToken;
      const res = await request(app.getHttpServer()).get("/api/v1/platform-admin/audit-log").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("lists a school's platform changes newest first, with who and which school, and no IP address", async () => {
      const school = await makeSchool("audit");
      await makePeople(school.id, "audit");
      expect((await pa("post", `schools/${school.id}/suspend`).send({ reason: "Audit spec" })).status).toBe(200);
      expect((await pa("post", `schools/${school.id}/reactivate`)).status).toBe(200);

      const res = await log(`?schoolId=${school.id}`);
      expect(res.status).toBe(200);
      expect(res.body.entries.map((e: { action: string }) => e.action)).toEqual([
        "platform_admin.schools.reactivate",
        "platform_admin.schools.suspend",
      ]);
      const suspend = res.body.entries[1];
      expect(suspend).toMatchObject({
        actorUserId: platformAdminUserId,
        actorName: "Owner host",
        schoolId: school.id,
        schoolName: `Lifecycle audit ${runId}`,
        metadata: { reason: "Audit spec" },
      });
      expect(Object.keys(suspend).sort()).toEqual(
        ["action", "actorName", "actorUserId", "at", "id", "metadata", "schoolId", "schoolName"].sort(),
      );
      expect(JSON.stringify(res.body)).not.toContain("ipAddress");
    });

    it("never shows a school's own audit rows — only the platform's", async () => {
      const school = await makeSchool("audit-own");
      await withTenant(school.id, (db) =>
        db.auditLog.create({
          data: { schoolId: school.id, userId: null, action: "student.create", entityType: "school", entityId: school.id },
        }),
      );
      const res = await log(`?schoolId=${school.id}&includeViews=true`);
      expect(res.status).toBe(200);
      expect(res.body.entries.map((e: { action: string }) => e.action)).not.toContain("student.create");
    });

    it("hides page views unless asked", async () => {
      expect((await pa("get", "schools")).status).toBe(200);
      const changes = await log("?limit=100");
      expect(changes.body.entries.some((e: { action: string }) => e.action.endsWith(".list"))).toBe(false);
      const all = await log("?includeViews=true&limit=100");
      expect(all.body.entries.some((e: { action: string }) => e.action === "platform_admin.schools.list")).toBe(true);
    });

    it("pages with a cursor, without repeating or skipping", async () => {
      const first = await log("?limit=2");
      expect(first.body.entries).toHaveLength(2);
      expect(typeof first.body.nextBefore).toBe("string");
      const second = await log(`?limit=2&before=${encodeURIComponent(first.body.nextBefore)}`);
      const both = await log("?limit=4");
      expect([...first.body.entries, ...second.body.entries].map((e: { id: string }) => e.id)).toEqual(
        both.body.entries.map((e: { id: string }) => e.id),
      );
    });

    it("keeps naming a school after it is deleted", async () => {
      const school = await makeSchool("audit-gone");
      expect((await pa("post", `schools/${school.id}/suspend`).send({ reason: "Before delete" })).status).toBe(200);
      expect((await pa("post", `schools/${school.id}/delete`).send({ confirmSlug: school.slug })).status).toBe(200);
      const res = await log(`?schoolId=${school.id}`);
      expect(res.body.entries.map((e: { action: string; schoolName: string }) => [e.action, e.schoolName])).toEqual([
        ["platform_admin.schools.delete", `Lifecycle audit-gone ${runId}`],
        // The suspend entry recorded no name of its own; it is still named.
        ["platform_admin.schools.suspend", `Lifecycle audit-gone ${runId}`],
      ]);
    });
  });
});
