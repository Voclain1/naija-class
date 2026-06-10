import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { REPORT_CARDS_QUEUE } from "../common/queue";
import { FilesystemStorageDriver } from "../common/storage/filesystem-storage.driver";
import { StorageService } from "../common/storage/storage.service";
import { AcademicYearsService } from "../modules/academic-years/academic-years.service";
import { AggregationService } from "../modules/assessment/aggregation.service";
import { AssessmentService } from "../modules/assessment/assessment.service";
import { AttendanceService } from "../modules/attendance/attendance.service";
import { AuthService } from "../modules/auth/auth.service";
import { ClassArmsService } from "../modules/class-arms/class-arms.service";
import { ClassLevelsService } from "../modules/class-levels/class-levels.service";
import { ClassSubjectsService } from "../modules/class-subjects/class-subjects.service";
import { EnrollmentsService } from "../modules/enrollments/enrollments.service";
import { GradingService } from "../modules/grading/grading.service";
import { GuardiansService } from "../modules/guardians/guardians.service";
import { ReportCardService } from "../modules/report-cards/report-card.service";
import { ReportCardWorkflowService } from "../modules/report-cards/workflow/report-card-workflow.service";
import { SchoolsService } from "../modules/schools/schools.service";
import { StudentsService } from "../modules/students/students.service";
import { SubjectAttendanceService } from "../modules/subject-attendance/subject-attendance.service";
import { SubjectsService } from "../modules/subjects/subjects.service";
import { TeacherAssignmentsService } from "../modules/teacher-assignments/teacher-assignments.service";
import { TeacherProfilesService } from "../modules/teacher-profiles/teacher-profiles.service";
import { TermsService } from "../modules/terms/terms.service";

// Slice 13 — consolidated audit-coverage regression guard.
//
// The deliverable "every Phase 1 mutation writes one row to audit_logs" is
// satisfied per-slice; this test LOCKS it so a future resource can't regress
// it silently. It exercises every Phase 1 mutation against the real DB and
// asserts exactly one audit row with the expected action (and entity id, where
// the mutation targets a single entity). Static introspection can't do this —
// audit writes are inline in services, not a decorator.
//
// One shared school; each `it` builds its own child entities so (action,
// entityId) pairs are unique. Bulk mutations (one row, no single entity) are
// each exercised exactly once in the file and asserted by action.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23487${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("Phase 1 audit coverage — every mutation writes one audit row", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

  const auth = new AuthService();
  const years = new AcademicYearsService();
  const terms = new TermsService();
  const levels = new ClassLevelsService();
  const arms = new ClassArmsService();
  const subjects = new SubjectsService();
  const classSubjects = new ClassSubjectsService();
  const students = new StudentsService();
  const guardians = new GuardiansService();
  const enrollments = new EnrollmentsService();
  const teacherProfiles = new TeacherProfilesService();
  const teacherAssignments = new TeacherAssignmentsService();

  let schoolId: string;
  let ownerCtx: { sessionId: string; userId: string; schoolId: string };
  let seededLevelId: string;
  let nextOrder = 200;

  const schoolIdsToCleanup = new Set<string>();

  beforeAll(async () => {
    const signed = await auth.signupOwner(
      {
        schoolName: `Audit Coverage ${runId}`,
        schoolSlug: `audit-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `audit-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolId = signed.school.id;
    schoolIdsToCleanup.add(schoolId);
    await basePrisma.school.update({
      where: { id: schoolId },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    ownerCtx = { sessionId: "sess", userId: signed.user.id, schoolId };
    seededLevelId = await withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
        select: { id: true },
      });
      return level.id;
    });
  });

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // Exactly one audit row for (action, entityId).
  async function expectOneAudit(action: string, entityId: string): Promise<void> {
    const rows = await withTenant(schoolId, (db) =>
      db.auditLog.findMany({ where: { action, entityId } }),
    );
    expect(rows.length, `audit rows for ${action} (${entityId})`).toBe(1);
  }

  // Exactly one audit row for an action with no single entity (bulk).
  async function expectOneAuditByAction(action: string): Promise<void> {
    const rows = await withTenant(schoolId, (db) =>
      db.auditLog.findMany({ where: { action } }),
    );
    expect(rows.length, `audit rows for ${action}`).toBe(1);
  }

  async function makeTeacher(suffix: string): Promise<string> {
    const teacherRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "teacher", isSystem: true },
      select: { id: true },
    });
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          email: `teacher-${suffix}-${runId}@example.test`,
          firstName: "Tunde",
          lastName: `Teacher-${suffix}`,
        },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: teacherRole.id } });
      return user.id;
    });
  }

  async function makeStudent(suffix: string): Promise<string> {
    const s = await students.create(
      ownerCtx,
      {
        admissionNumber: `ADM/${runId}/${suffix}`,
        firstName: "Ada",
        lastName: "Okafor",
        dateOfBirth: new Date("2014-03-15"),
        gender: "FEMALE",
      },
      reqCtx,
    );
    return s.id;
  }

  async function makeYearWithTerm(suffix: string): Promise<{ yearId: string; termId: string }> {
    const year = await years.create(
      ownerCtx,
      { label: `Y-${suffix}-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
      reqCtx,
    );
    const term = await terms.create(
      ownerCtx,
      year.id,
      { sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
      reqCtx,
    );
    return { yearId: year.id, termId: term.id };
  }

  async function makeArm(suffix: string): Promise<string> {
    const arm = await arms.create(
      ownerCtx,
      seededLevelId,
      { name: `Arm ${suffix}`, code: `arm-${suffix}-${runId}` },
      reqCtx,
    );
    return arm.id;
  }

  async function makeSubject(suffix: string): Promise<string> {
    const subj = await subjects.create(
      ownerCtx,
      { name: `Subject ${suffix}`, code: `subj-${suffix}-${runId}` },
      reqCtx,
    );
    return subj.id;
  }

  // ---- Academic year ----------------------------------------------------
  it("academic-year: create / update / set-current / delete", async () => {
    const y = await years.create(
      ownerCtx,
      { label: `AY-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
      reqCtx,
    );
    await expectOneAudit("academic-year.create", y.id);

    await years.update(ownerCtx, y.id, { label: `AY2-${runId}` }, reqCtx);
    await expectOneAudit("academic-year.update", y.id);

    await years.setCurrent(ownerCtx, y.id, reqCtx);
    await expectOneAudit("academic-year.set-current", y.id);

    await years.delete(ownerCtx, y.id, reqCtx);
    await expectOneAudit("academic-year.delete", y.id);
  });

  // ---- Term -------------------------------------------------------------
  it("term: create / update / set-current / delete", async () => {
    const year = await years.create(
      ownerCtx,
      { label: `TY-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
      reqCtx,
    );
    const t = await terms.create(
      ownerCtx,
      year.id,
      { sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
      reqCtx,
    );
    await expectOneAudit("term.create", t.id);

    await terms.update(ownerCtx, t.id, { name: "Term One" }, reqCtx);
    await expectOneAudit("term.update", t.id);

    await terms.setCurrent(ownerCtx, t.id, reqCtx);
    await expectOneAudit("term.set-current", t.id);

    await terms.delete(ownerCtx, t.id, reqCtx);
    await expectOneAudit("term.delete", t.id);
  });

  // ---- Class level ------------------------------------------------------
  it("class-level: create / update / delete", async () => {
    const lvl = await levels.create(
      ownerCtx,
      { name: `Lvl ${runId}`, code: `lvl-${runId}`, stage: "JSS", orderIndex: nextOrder++ },
      reqCtx,
    );
    await expectOneAudit("class-level.create", lvl.id);

    await levels.update(ownerCtx, lvl.id, { name: `Lvl2 ${runId}` }, reqCtx);
    await expectOneAudit("class-level.update", lvl.id);

    await levels.delete(ownerCtx, lvl.id, reqCtx);
    await expectOneAudit("class-level.delete", lvl.id);
  });

  // ---- Class arm --------------------------------------------------------
  it("class-arm: create / update / delete", async () => {
    const arm = await arms.create(
      ownerCtx,
      seededLevelId,
      { name: "Arm CUD", code: `arm-cud-${runId}` },
      reqCtx,
    );
    await expectOneAudit("class-arm.create", arm.id);

    await arms.update(ownerCtx, arm.id, { name: "Arm CUD2" }, reqCtx);
    await expectOneAudit("class-arm.update", arm.id);

    await arms.delete(ownerCtx, arm.id, reqCtx);
    await expectOneAudit("class-arm.delete", arm.id);
  });

  // ---- Subject ----------------------------------------------------------
  it("subject: create / update / delete", async () => {
    const subj = await subjects.create(
      ownerCtx,
      { name: "Subject CUD", code: `subj-cud-${runId}` },
      reqCtx,
    );
    await expectOneAudit("subject.create", subj.id);

    await subjects.update(ownerCtx, subj.id, { name: "Subject CUD2" }, reqCtx);
    await expectOneAudit("subject.update", subj.id);

    await subjects.delete(ownerCtx, subj.id, reqCtx);
    await expectOneAudit("subject.delete", subj.id);
  });

  // ---- Class subject ----------------------------------------------------
  it("class-subject: create / update / delete / bulk", async () => {
    const subjForLink = await makeSubject("cs-link");
    const link = await classSubjects.create(ownerCtx, seededLevelId, { subjectId: subjForLink }, reqCtx);
    await expectOneAudit("class-subject.create", link.id);

    await classSubjects.update(ownerCtx, link.id, { isCore: false }, reqCtx);
    await expectOneAudit("class-subject.update", link.id);

    await classSubjects.delete(ownerCtx, link.id, reqCtx);
    await expectOneAudit("class-subject.delete", link.id);

    const subjForBulk = await makeSubject("cs-bulk");
    await classSubjects.bulk(
      ownerCtx,
      seededLevelId,
      { create: [{ subjectId: subjForBulk }], delete: [] },
      reqCtx,
    );
    await expectOneAuditByAction("class-subject.bulk");
  });

  // ---- Student lifecycle ------------------------------------------------
  it("student: create / update / withdraw / reactivate / graduate", async () => {
    const id = await makeStudent("life");
    await expectOneAudit("student.create", id);

    await students.update(ownerCtx, id, { medicalNotes: "note" }, reqCtx);
    await expectOneAudit("student.update", id);

    await students.withdraw(ownerCtx, id, {}, reqCtx);
    await expectOneAudit("student.withdraw", id);

    await students.reactivate(ownerCtx, id, {}, reqCtx);
    await expectOneAudit("student.reactivate", id);

    await students.graduate(ownerCtx, id, {}, reqCtx);
    await expectOneAudit("student.graduate", id);
  });

  // ---- Guardian + student-guardian links --------------------------------
  it("guardian: create / update / delete and student-guardian create / update / delete", async () => {
    const studentId = await makeStudent("guard");

    const g = await guardians.create(
      ownerCtx,
      { firstName: "Bola", lastName: "Parent", relationship: "MOTHER", phone: randomPhone() },
      reqCtx,
    );
    await expectOneAudit("guardian.create", g.id);

    await guardians.update(ownerCtx, g.id, { occupation: "Accountant" }, reqCtx);
    await expectOneAudit("guardian.update", g.id);

    const link = await guardians.linkExisting(ownerCtx, studentId, { guardianId: g.id }, reqCtx);
    await expectOneAudit("student-guardian.create", link.link.id);

    await guardians.updateLink(ownerCtx, link.link.id, { isPrimary: true }, reqCtx);
    await expectOneAudit("student-guardian.update", link.link.id);

    await guardians.unlink(ownerCtx, link.link.id, reqCtx);
    await expectOneAudit("student-guardian.delete", link.link.id);

    await guardians.delete(ownerCtx, g.id, reqCtx);
    await expectOneAudit("guardian.delete", g.id);
  });

  // ---- Enrollment -------------------------------------------------------
  it("enrollment: create / update / delete / bulk-create", async () => {
    const { termId } = await makeYearWithTerm("enr");
    const armId = await makeArm("enr");
    const studentId = await makeStudent("enr");

    const enr = await enrollments.create(
      ownerCtx,
      { studentId, termId, classArmId: armId },
      reqCtx,
    );
    await expectOneAudit("enrollment.create", enr.id);

    await enrollments.update(ownerCtx, enr.id, { status: "WITHDRAWN" }, reqCtx);
    await expectOneAudit("enrollment.update", enr.id);

    await enrollments.delete(ownerCtx, enr.id, reqCtx);
    await expectOneAudit("enrollment.delete", enr.id);

    const bulkStudent = await makeStudent("enr-bulk");
    await enrollments.bulkCreate(
      ownerCtx,
      { termId, classArmId: armId, studentIds: [bulkStudent] },
      reqCtx,
    );
    await expectOneAuditByAction("enrollment.bulk-create");
  });

  // ---- Teacher profile (admin CRUD + self-service) ----------------------
  it("teacher-profile: create / update / updateMine / delete", async () => {
    const teacherId = await makeTeacher("tp");
    const profile = await teacherProfiles.create(
      ownerCtx,
      { userId: teacherId, staffNumber: `STAFF/${runId}/1`, specialty: "Mathematics" },
      reqCtx,
    );
    await expectOneAudit("teacher-profile.create", profile.id);

    await teacherProfiles.update(ownerCtx, profile.id, { specialty: "Physics" }, reqCtx);
    // self-update writes the same teacher-profile.update action against the
    // same profile id, so assert the admin update independently first.
    const afterAdminUpdate = await withTenant(schoolId, (db) =>
      db.auditLog.count({ where: { action: "teacher-profile.update", entityId: profile.id } }),
    );
    expect(afterAdminUpdate).toBe(1);

    await teacherProfiles.updateMine(
      { sessionId: "sess", userId: teacherId, schoolId },
      { specialty: "Further Maths" },
      reqCtx,
    );
    const afterSelfUpdate = await withTenant(schoolId, (db) =>
      db.auditLog.count({ where: { action: "teacher-profile.update", entityId: profile.id } }),
    );
    expect(afterSelfUpdate).toBe(2);

    // delete uses a fresh teacher/profile so the deactivation doesn't disturb
    // the one above.
    const teacherForDelete = await makeTeacher("tp-del");
    const profileForDelete = await teacherProfiles.create(
      ownerCtx,
      { userId: teacherForDelete, staffNumber: `STAFF/${runId}/2` },
      reqCtx,
    );
    await teacherProfiles.delete(ownerCtx, profileForDelete.id, reqCtx);
    await expectOneAudit("teacher-profile.delete", profileForDelete.id);
  });

  // ---- Teacher assignment ----------------------------------------------
  it("teacher-assignment: create / update / delete", async () => {
    const teacherId = await makeTeacher("ta");
    const { yearId } = await makeYearWithTerm("ta");
    const armId = await makeArm("ta");
    const subjId = await makeSubject("ta");

    const assignment = await teacherAssignments.create(
      ownerCtx,
      { teacherId, classArmId: armId, subjectId: subjId, academicYearId: yearId },
      reqCtx,
    );
    await expectOneAudit("teacher-assignment.create", assignment.id);

    await teacherAssignments.update(ownerCtx, assignment.id, { isActive: false }, reqCtx);
    await expectOneAudit("teacher-assignment.update", assignment.id);

    await teacherAssignments.delete(ownerCtx, assignment.id, reqCtx);
    await expectOneAudit("teacher-assignment.delete", assignment.id);
  });
});

// ===========================================================================
// Phase 2 audit coverage (slice 9 cp2). Mirrors the Phase 1 block: every Phase 2
// mutation writes an audit row with the expected action + actor + metadata
// shape (required keys present, not exact values). Two schools — a "config"
// school for the grading + school.update mutations (freely mutate the seeded
// scheme; no scores so it isn't frozen) and a "pipeline" school for the
// assessment → report-card → attendance chain.
//
// FINDINGS from slice-9 cp2 (see docs/journal/2026-06-09):
//   • render IS audited — enqueueArmRender writes `report-card.render-batch`
//     (and the render worker writes `report-card.render` per card). NOT the
//     "intentional absence" the plan assumed; the spec asserts the real
//     `report-card.render-batch`. Auditing is appropriate for PDF-debug forensics.
//   • the approve transition's audit action was `report-card.approve`, diverging
//     from its `@Permissions` key `report-card.principal-approve`. RENAMED to
//     `report-card.principal-approve` (workflow service + a data migration
//     rewriting existing audit_logs rows); asserted under the canonical name here.
// ===========================================================================
describe("Phase 2 audit coverage — every mutation writes an audit row", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const ctx = (schoolId: string, userId: string) => ({ sessionId: "sess", userId, schoolId });

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

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `Audit P2 ${suffix}`,
        schoolSlug: `audit-p2-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `audit-p2-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  // Asserts an audit row exists for (action[, entityId]) with the right actor
  // and the required metadata keys present (shape contract, not exact values).
  async function expectAudit(
    schoolId: string,
    action: string,
    opts: { entityId?: string; actorId: string; keys: string[] },
  ): Promise<void> {
    const row = await withTenant(schoolId, (db) =>
      db.auditLog.findFirst({
        where: opts.entityId ? { action, entityId: opts.entityId } : { action },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(row, `audit row for ${action}`).toBeTruthy();
    expect(row!.userId, `${action} actor`).toBe(opts.actorId);
    const meta = (row!.metadata ?? {}) as Record<string, unknown>;
    for (const k of opts.keys) {
      expect(meta, `${action} metadata missing '${k}'`).toHaveProperty(k);
    }
  }

  // Pipeline fixture (shared by the assessment / report-card / attendance its).
  let pipe: {
    schoolId: string;
    ownerId: string;
    yearId: string;
    termId: string;
    armId: string;
    subjectId: string;
    comp: { ca1: string; ca2: string; exam: string };
    students: string[];
  };

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "audit-p2-"));
    storage = new StorageService(new FilesystemStorageDriver(storageRoot));
    // Isolated queue NAME so a stray dev:api worker can't steal the enqueued jobs.
    queue = new Queue(`${REPORT_CARDS_QUEUE}-audit-${runId}`, { connection: redisConnection() });
    await queue.obliterate({ force: true });
    reportCards = new ReportCardService(aggregation, storage, queue);
    workflow = new ReportCardWorkflowService(reportCards);

    // Build the pipeline school's fixture: year/term/level/arm/subject + two
    // enrolled students + the seeded grading components. subjectAttendance on.
    const { schoolId, ownerId } = await makeSchool("pipe");
    await basePrisma.school.update({ where: { id: schoolId }, data: { subjectAttendanceEnabled: true } });
    const fixture = await withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15"), isCurrent: true },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "Arm P2", code: `arm-p2-${runId}` },
        select: { id: true },
      });
      const subject = await db.subject.create({
        data: { schoolId, name: "Maths P2", code: `maths-p2-${runId}` },
        select: { id: true },
      });
      const students: string[] = [];
      for (const n of ["a", "b"]) {
        const s = await db.student.create({
          data: { schoolId, admissionNumber: `ADM-p2-${n}-${runId}`, firstName: "Stu", lastName: `P-${n}`, dateOfBirth: new Date("2013-05-10"), gender: "FEMALE" },
          select: { id: true },
        });
        await db.enrollment.create({
          data: { schoolId, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: "ENROLLED", enrolledAt: new Date("2025-09-01") },
        });
        students.push(s.id);
      }
      const comps = await db.gradingComponent.findMany({ select: { id: true, key: true } });
      const byKey = new Map(comps.map((cc) => [cc.key, cc.id]));
      return {
        yearId: year.id,
        termId: term.id,
        armId: arm.id,
        subjectId: subject.id,
        comp: { ca1: byKey.get("ca1")!, ca2: byKey.get("ca2")!, exam: byKey.get("exam")! },
        students,
      };
    });
    pipe = { schoolId, ownerId, ...fixture };
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  // ---- grading config + school.update (own school) ------------------------
  it("grading + school.update mutations each write an audit row", async () => {
    const { schoolId, ownerId } = await makeSchool("cfg");
    const c = ctx(schoolId, ownerId);
    const seeded = await withTenant(schoolId, async (db) => {
      const scheme = await db.gradingScheme.findFirstOrThrow({ select: { id: true } });
      const boundary = await db.gradeBoundary.findFirstOrThrow({ select: { id: true } });
      return { schemeId: scheme.id, boundaryId: boundary.id };
    });

    await grading.updateScheme(c, { name: "Updated Scheme" }, reqCtx);
    await expectAudit(schoolId, "grading-scheme.update", { entityId: seeded.schemeId, actorId: ownerId, keys: ["changed"] });

    await grading.updateBoundary(c, seeded.boundaryId, { remark: "Top marks" }, reqCtx);
    await expectAudit(schoolId, "grade-boundary.update", { entityId: seeded.boundaryId, actorId: ownerId, keys: ["changed"] });

    // Bulk replace with a valid (sum=100) set → grading-component.update.
    await grading.replaceComponents(c, {
      components: [
        { key: "ca1", label: "CA1", weight: 20, orderIndex: 1 },
        { key: "ca2", label: "CA2", weight: 20, orderIndex: 2 },
        { key: "exam", label: "Exam", weight: 60, orderIndex: 3 },
      ],
    }, reqCtx);
    await expectAudit(schoolId, "grading-component.update", { actorId: ownerId, keys: ["bulk", "count"] });

    // A weight-0 component keeps sum=100 so create + delete both validate.
    const extra = await grading.createComponent(c, { key: "extra", label: "Extra", weight: 0, orderIndex: 4 }, reqCtx);
    await expectAudit(schoolId, "grading-component.create", { entityId: extra.id, actorId: ownerId, keys: ["key"] });

    await grading.deleteComponent(c, extra.id, reqCtx);
    await expectAudit(schoolId, "grading-component.delete", { entityId: extra.id, actorId: ownerId, keys: ["key"] });

    await schools.patchMe(c, { name: "Renamed School" }, reqCtx);
    await expectAudit(schoolId, "school.update", { actorId: ownerId, keys: ["changed"] });
  });

  // ---- assessment → report-card pipeline (one ordered walk) ---------------
  it("assessment + report-card mutations each write an audit row", async () => {
    const { schoolId, ownerId, termId, armId, subjectId, comp, students } = pipe;
    const c = ctx(schoolId, ownerId);
    const [s1, s2] = students;

    // Enter a full column for both students via single createScore calls (no
    // bulk → every assessment-score.create row keeps the single shape).
    for (const studentId of [s1, s2]) {
      for (const [componentId, score] of [[comp.ca1, 15], [comp.ca2, 15], [comp.exam, 50]] as const) {
        await assessment.createScore(c, { studentId, subjectId, termId, componentId, score }, reqCtx);
      }
    }
    await expectAudit(schoolId, "assessment-score.create", { actorId: ownerId, keys: ["studentId", "subjectId", "termId", "componentId"] });

    const scoreId = await withTenant(schoolId, (db) =>
      db.assessmentScore.findFirstOrThrow({ where: { studentId: s1, componentId: comp.ca1, termId }, select: { id: true } }).then((r) => r.id),
    );
    await assessment.updateScore(c, scoreId, { score: 16 }, reqCtx);
    await expectAudit(schoolId, "assessment-score.update", { actorId: ownerId, keys: ["studentId", "subjectId", "termId", "componentId"] });

    await aggregation.aggregate(c, { termId, classArmId: armId }, reqCtx);
    await expectAudit(schoolId, "assessment.aggregate", { actorId: ownerId, keys: ["termId", "classArmId", "studentCount", "updateCount", "mode"] });

    // Report cards: build → comment → sign-off column → form-review →
    // principal-note → approve → render-batch → release → reopen.
    await reportCards.build(c, { termId, classArmId: armId }, reqCtx);
    await expectAudit(schoolId, "report-card.build", { actorId: ownerId, keys: ["termId", "classArmId", "cardCount", "mode"] });

    const cardId = await withTenant(schoolId, (db) =>
      db.reportCard.findFirstOrThrow({ where: { termId, classArmId: armId, studentId: s1 }, select: { id: true } }).then((r) => r.id),
    );
    await workflow.editFormTeacherComment(c, cardId, { formTeacherComment: "Good term." }, reqCtx);
    await expectAudit(schoolId, "report-card.comment", { entityId: cardId, actorId: ownerId, keys: ["reportCardId", "field", "termId", "classArmId"] });

    // Sign off the whole column (assessment.sign-off, bulk) → the cascade
    // advances the arm's cards to SUBJECT_REVIEWED, which form-review requires.
    await assessment.signOffColumn(c, { termId, classArmId: armId, subjectId }, reqCtx);
    await expectAudit(schoolId, "assessment.sign-off", { actorId: ownerId, keys: ["termId", "subjectId", "classArmId", "count"] });

    await workflow.formReview(c, { termId, classArmId: armId }, reqCtx);
    await expectAudit(schoolId, "report-card.form-review", { entityId: armId, actorId: ownerId, keys: ["termId", "classArmId", "fromStatus", "toStatus", "cardCount"] });

    await workflow.editPrincipalNote(c, { termId, classArmId: armId, principalNote: "Well done." }, reqCtx);
    await expectAudit(schoolId, "report-card.comment", { entityId: armId, actorId: ownerId, keys: ["termId", "classArmId", "field", "cardCount"] });

    await workflow.approve(c, { termId, classArmId: armId }, reqCtx);
    await expectAudit(schoolId, "report-card.principal-approve", { entityId: armId, actorId: ownerId, keys: ["termId", "classArmId", "fromStatus", "toStatus", "cardCount"] });

    await reportCards.enqueueArmRender(c, { termId, classArmId: armId }, reqCtx);
    await expectAudit(schoolId, "report-card.render-batch", { entityId: armId, actorId: ownerId, keys: ["termId", "classArmId", "enqueuedCount"] });

    await workflow.release(c, { termId, classArmId: armId }, reqCtx);
    await expectAudit(schoolId, "report-card.release", { entityId: armId, actorId: ownerId, keys: ["fromStatus", "toStatus", "cardCount", "enqueuedCount"] });

    await workflow.reopen(c, { termId, classArmId: armId, reason: "Correction needed." }, reqCtx);
    await expectAudit(schoolId, "report-card.reopen", { entityId: armId, actorId: ownerId, keys: ["fromStatuses", "toStatus", "reason", "cardCount"] });
  });

  // ---- attendance (universal) ---------------------------------------------
  it("attendance.mark writes an audit row", async () => {
    const { schoolId, ownerId, armId, students } = pipe;
    const c = ctx(schoolId, ownerId);
    await attendance.markBulk(
      c,
      { classArmId: armId, date: "2025-10-01", records: students.map((studentId) => ({ studentId, status: "PRESENT" as const })) },
      reqCtx,
    );
    await expectAudit(schoolId, "attendance.mark", { entityId: armId, actorId: ownerId, keys: ["classArmId", "termId", "date", "count", "byStatus"] });
  });

  // ---- subject-period attendance (opt-in; flag enabled in beforeAll) -------
  it("subject-attendance.mark writes an audit row", async () => {
    const { schoolId, ownerId, armId, subjectId, students } = pipe;
    const c = ctx(schoolId, ownerId);
    await subjectAttendance.markBulk(
      c,
      { classArmId: armId, subjectId, date: "2025-10-01", period: 1, records: students.map((studentId) => ({ studentId, status: "PRESENT" as const })) },
      reqCtx,
    );
    await expectAudit(schoolId, "subject-attendance.mark", { entityId: armId, actorId: ownerId, keys: ["classArmId", "subjectId", "termId", "date", "period", "count", "byStatus"] });
  });
});
