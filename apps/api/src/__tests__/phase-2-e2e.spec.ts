import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError } from "@school-kit/types";

import { REPORT_CARDS_QUEUE } from "../common/queue";
import { FilesystemStorageDriver } from "../common/storage/filesystem-storage.driver";
import { StorageService } from "../common/storage/storage.service";
import { AggregationService } from "../modules/assessment/aggregation.service";
import { AssessmentService } from "../modules/assessment/assessment.service";
import { AttendanceService } from "../modules/attendance/attendance.service";
import { AuthService } from "../modules/auth/auth.service";
import { GradingService } from "../modules/grading/grading.service";
import { ReportCardService } from "../modules/report-cards/report-card.service";
import { ReportCardWorkflowService } from "../modules/report-cards/workflow/report-card-workflow.service";
import { SchoolsService } from "../modules/schools/schools.service";
import { SubjectAttendanceService } from "../modules/subject-attendance/subject-attendance.service";

// Phase 2 / Slice 9 cp3 — the close-out E2E rollup. API/service-level walks
// (not browser) that mirror the critical-path UI flows + the two security tiers:
//   WALK 1 — the Phase 2 happy path composed end-to-end through every surface.
//   WALK 2 — cross-tenant denial: School B cannot touch School A's data (RLS).
//   WALK 3 — in-school teacher-scope negatives (the "scope leaks within-school"
//            hard rule): a teacher can't reach another arm/subject, can't run
//            owner/admin-only actions, can't read /schools/me.
// Each walk builds its own ephemeral schools via signupOwner — no dev-seed.

const TERM_START = new Date("2025-09-01");
const TERM_END = new Date("2025-12-15");
const IN_TERM_DATE = "2025-10-01";

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  return `+23493${(phoneCounter % 100).toString().padStart(2, "0")}${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
}
const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}
function redisConnection() {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const p = new URL(url);
  return {
    host: p.hostname,
    port: p.port ? Number(p.port) : 6379,
    username: p.username || undefined,
    password: p.password || undefined,
    db: p.pathname && p.pathname.length > 1 ? Number(p.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

interface Fixture {
  schoolId: string;
  ownerId: string;
  teacherId: string; // T1 — form teacher of jss1a + assigned jss1a Maths
  yearId: string;
  termId: string;
  jss1aId: string; // T1's arm
  jss2aId: string; // owner's arm (the pipeline runs here)
  subjectId: string; // Maths
  students: string[]; // enrolled in jss2a
  comp: { ca1: string; ca2: string; exam: string };
}

describe("Phase 2 E2E rollup (slice 9 cp3)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const grading = new GradingService();
  const assessment = new AssessmentService();
  const aggregation = new AggregationService();
  const attendance = new AttendanceService();
  const subjectAttendance = new SubjectAttendanceService();
  const schools = new SchoolsService();

  let storageRoot: string;
  let storage: StorageService;
  let queue: Queue;
  let reportCards: ReportCardService;
  let workflow: ReportCardWorkflowService;

  const schoolIds = new Set<string>();

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "p2-e2e-"));
    storage = new StorageService(new FilesystemStorageDriver(storageRoot));
    queue = new Queue(`${REPORT_CARDS_QUEUE}-e2e-${runId}`, { connection: redisConnection() });
    await queue.obliterate({ force: true });
    reportCards = new ReportCardService(aggregation, storage, queue);
    workflow = new ReportCardWorkflowService(reportCards);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `E2E ${suffix}`,
        schoolSlug: `e2e-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `e2e-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  async function grantTeacher(schoolId: string, suffix: string): Promise<string> {
    const role = await basePrisma.role.findFirstOrThrow({ where: { schoolId: null, key: "teacher", isSystem: true }, select: { id: true } });
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({ data: { schoolId, email: `t-${suffix}-${runId}@example.test`, firstName: "T", lastName: "One" }, select: { id: true } });
      await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      return u.id;
    });
  }

  // Full per-school fixture: year/term, level, two arms (jss1a form-taught by T1,
  // jss2a form-taught by owner), Maths subject, two students enrolled in jss2a,
  // and T1 assigned to teach Maths in jss1a. Returns the ids + the seeded
  // grading components.
  async function buildFixture(suffix: string): Promise<Fixture> {
    const { schoolId, ownerId } = await makeSchool(suffix);
    const teacherId = await grantTeacher(schoolId, suffix);
    const f = await withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
      const year = await db.academicYear.create({ data: { schoolId, label: `Y-${suffix}-${runId}`, startDate: TERM_START, endDate: TERM_END }, select: { id: true } });
      const term = await db.term.create({ data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: TERM_START, endDate: TERM_END, isCurrent: true }, select: { id: true } });
      const jss1a = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS 1 A", code: `jss1a-${runId}`, classTeacherId: teacherId }, select: { id: true } });
      const jss2a = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS 2 A", code: `jss2a-${runId}`, classTeacherId: ownerId }, select: { id: true } });
      const subject = await db.subject.create({ data: { schoolId, name: "Maths", code: `maths-${runId}` }, select: { id: true } });
      // T1 teaches Maths in jss1a only.
      await db.teacherAssignment.create({ data: { schoolId, teacherId, classArmId: jss1a.id, subjectId: subject.id, academicYearId: year.id, isActive: true } });
      const students: string[] = [];
      for (const n of ["a", "b"]) {
        const s = await db.student.create({ data: { schoolId, admissionNumber: `ADM-${suffix}-${n}-${runId}`, firstName: "Stu", lastName: `P-${n}`, dateOfBirth: new Date("2013-05-10"), gender: "FEMALE" }, select: { id: true } });
        await db.enrollment.create({ data: { schoolId, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: jss2a.id, status: "ENROLLED", enrolledAt: TERM_START } });
        students.push(s.id);
      }
      const comps = await db.gradingComponent.findMany({ select: { id: true, key: true } });
      const byKey = new Map(comps.map((cc) => [cc.key, cc.id]));
      return { yearId: year.id, termId: term.id, jss1aId: jss1a.id, jss2aId: jss2a.id, subjectId: subject.id, students, comp: { ca1: byKey.get("ca1")!, ca2: byKey.get("ca2")!, exam: byKey.get("exam")! } };
    });
    return { schoolId, ownerId, teacherId, ...f };
  }

  // =========================================================================
  // WALK 1 — critical path: the Phase 2 happy path through every surface.
  // =========================================================================
  it("WALK 1: critical path composes end-to-end through every Phase 2 surface", async () => {
    const a = await buildFixture("w1");
    const o = ctx(a.schoolId, a.ownerId);
    const [s1, s2] = a.students;

    // Grading config (slice 4): re-affirm the seeded scheme + boundaries.
    const scheme = await grading.replaceComponents(o, {
      components: [
        { key: "ca1", label: "CA1", weight: 20, orderIndex: 1 },
        { key: "ca2", label: "CA2", weight: 20, orderIndex: 2 },
        { key: "exam", label: "Exam", weight: 60, orderIndex: 3 },
      ],
    }, reqCtx);
    expect(scheme.components).toHaveLength(3);
    const comps = await withTenant(a.schoolId, (db) => db.gradingComponent.findMany({ select: { id: true, key: true } }));
    const comp = { ca1: comps.find((c) => c.key === "ca1")!.id, ca2: comps.find((c) => c.key === "ca2")!.id, exam: comps.find((c) => c.key === "exam")!.id };

    // Scores (slice 2): owner enters a full column for both students.
    for (const studentId of [s1, s2]) {
      for (const [componentId, score] of [[comp.ca1, 15], [comp.ca2, 15], [comp.exam, 50]] as const) {
        const res = await assessment.createScore(o, { studentId, subjectId: a.subjectId, termId: a.termId, componentId, score }, reqCtx);
        expect(res.assessment?.totalScore).toBeTypeOf("number");
      }
    }

    // Aggregate (slice 3/4) → positions.
    const agg = await aggregation.aggregate(o, { termId: a.termId, classArmId: a.jss2aId }, reqCtx);
    expect(agg.studentCount).toBe(2);

    // Build report cards (slice 5) → DRAFT.
    const built = await reportCards.build(o, { termId: a.termId, classArmId: a.jss2aId }, reqCtx);
    expect(built.cardCount).toBe(2);

    // Sign off the column (slice 2) → cascade advances cards to SUBJECT_REVIEWED.
    await assessment.signOffColumn(o, { termId: a.termId, classArmId: a.jss2aId, subjectId: a.subjectId }, reqCtx);
    const board = await reportCards.getBoard(o, { termId: a.termId, classArmId: a.jss2aId });
    expect(board.data.every((r) => r.reportCard?.status === "SUBJECT_REVIEWED")).toBe(true);

    // Workflow (slice 6): form-review → approve → release.
    const fr = await workflow.formReview(o, { termId: a.termId, classArmId: a.jss2aId }, reqCtx);
    expect(fr.status).toBe("FORM_REVIEWED");
    const ap = await workflow.approve(o, { termId: a.termId, classArmId: a.jss2aId }, reqCtx);
    expect(ap.status).toBe("PRINCIPAL_APPROVED");
    const rel = await workflow.release(o, { termId: a.termId, classArmId: a.jss2aId }, reqCtx);
    expect(rel.status).toBe("RELEASED");

    // Daily attendance (slice 7).
    const att = await attendance.markBulk(o, { classArmId: a.jss2aId, date: IN_TERM_DATE, records: [s1, s2].map((studentId) => ({ studentId, status: "PRESENT" as const })) }, reqCtx);
    expect(att.count).toBe(2);

    // Subject-period attendance (slice 8) — enable the flag, then mark.
    await basePrisma.school.update({ where: { id: a.schoolId }, data: { subjectAttendanceEnabled: true } });
    const sub = await subjectAttendance.markBulk(o, { classArmId: a.jss2aId, subjectId: a.subjectId, date: IN_TERM_DATE, period: 1, records: [s1, s2].map((studentId) => ({ studentId, status: "PRESENT" as const })) }, reqCtx);
    expect(sub.count).toBe(2);

    // Cross-check: a release audit row was written (audit coverage is locked
    // separately; here we just confirm the path produced one).
    const releaseAudit = await withTenant(a.schoolId, (db) => db.auditLog.findFirst({ where: { action: "report-card.release", entityId: a.jss2aId } }));
    expect(releaseAudit).toBeTruthy();
  });

  // =========================================================================
  // WALK 2 — cross-tenant denial: School B cannot touch School A's data.
  // =========================================================================
  it("WALK 2: a second school cannot read or write the first school's data", async () => {
    const a = await buildFixture("w2a");
    const b = await buildFixture("w2b");
    const bo = ctx(b.schoolId, b.ownerId); // School B owner acting on School A ids
    const [aStudent] = a.students;

    // Seed one School-A report card + an A-tenant attendance row to read across.
    const ao = ctx(a.schoolId, a.ownerId);
    await reportCards.build(ao, { termId: a.termId, classArmId: a.jss2aId }, reqCtx);
    const aCardId = await withTenant(a.schoolId, (db) => db.reportCard.findFirstOrThrow({ where: { classArmId: a.jss2aId }, select: { id: true } }).then((r) => r.id));

    // Report card read across tenants → 404 (RLS hides A's card from B).
    await expect(reportCards.getById(bo, aCardId)).rejects.toBeInstanceOf(NotFoundError);

    // Report-card board for A's arm, queried as B → A's arm/term invisible → 404.
    await expect(reportCards.getBoard(bo, { termId: a.termId, classArmId: a.jss2aId })).rejects.toBeInstanceOf(NotFoundError);

    // Assessment feed for A's column, as B → RLS filters the rows: an empty
    // feed, never A's students. (getFeed doesn't 404 a missing arm — it returns
    // the tenant-scoped query result, which for B is empty.)
    const feed = await assessment.getFeed(bo, { termId: a.termId, classArmId: a.jss2aId, subjectId: a.subjectId });
    expect(feed.data).toHaveLength(0);

    // Daily attendance register for A's arm, as B (B has its own term covering
    // the date) → A's enrollments hidden → empty roster, never A's students.
    const reg = await attendance.getRegister(bo, { classArmId: a.jss2aId, date: IN_TERM_DATE });
    expect(reg.records).toHaveLength(0);

    // Marking attendance for A's arm with A's student, as B → the student is not
    // on B's roster for that arm → rejected (no row written into A).
    await expect(
      attendance.markBulk(bo, { classArmId: a.jss2aId, date: IN_TERM_DATE, records: [{ studentId: aStudent, status: "PRESENT" }] }, reqCtx),
    ).rejects.toBeTruthy();
    const leaked = await withTenant(a.schoolId, (db) => db.attendanceRecord.count({ where: { classArmId: a.jss2aId } }));
    expect(leaked).toBe(0);
  });

  // =========================================================================
  // WALK 3 — in-school teacher-scope negatives.
  // =========================================================================
  it("WALK 3: a teacher cannot act outside their arm/subject scope or above their role", async () => {
    const a = await buildFixture("w3");
    const t = ctx(a.schoolId, a.teacherId); // T1: form teacher of jss1a, teaches jss1a Maths
    const [s1] = a.students; // enrolled in jss2a (NOT T1's arm)

    // Score entry for jss2a Maths — T1 doesn't teach jss2a → 404 (out of scope).
    await expect(
      assessment.createScore(t, { studentId: s1, subjectId: a.subjectId, termId: a.termId, componentId: a.comp.ca1, score: 10 }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Daily attendance for jss2a — T1 is not its form teacher and the arm is out
    // of their scope → 404.
    await expect(
      attendance.markBulk(t, { classArmId: a.jss2aId, date: IN_TERM_DATE, records: [{ studentId: s1, status: "PRESENT" }] }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Approve report cards for jss1a — approval is owner/admin only; a teacher
    // (even the form teacher of the arm) is forbidden → 403.
    await expect(
      workflow.approve(t, { termId: a.termId, classArmId: a.jss1aId }, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // School config read — owner/admin only (slice-9 cp2 tighten) → 403.
    await expect(schools.findMe(t)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
