import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AcademicYearsService } from "../modules/academic-years/academic-years.service";
import { AuthService } from "../modules/auth/auth.service";
import { ClassArmsService } from "../modules/class-arms/class-arms.service";
import { ClassLevelsService } from "../modules/class-levels/class-levels.service";
import { ClassSubjectsService } from "../modules/class-subjects/class-subjects.service";
import { EnrollmentsService } from "../modules/enrollments/enrollments.service";
import { GuardiansService } from "../modules/guardians/guardians.service";
import { StudentsService } from "../modules/students/students.service";
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
