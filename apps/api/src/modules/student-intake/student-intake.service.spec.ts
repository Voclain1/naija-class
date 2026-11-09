import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { basePrisma, withTenant } from "@school-kit/db";
import type { PrepareStudentIntakeInput, StudentIntakeProposalDto } from "@school-kit/types";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../../common/auth/auth-context";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service";
import { deleteSchoolRows } from "../platform-admin/school-deletion";
import { StudentsService } from "../students/students.service";
import { StudentIntakeSweeperService } from "./student-intake-sweeper.service";
import { StudentIntakeService } from "./student-intake.service";

// Real PostgreSQL, as app_user under RLS (docs/modules/student-intake-proposals.md).

const schoolIds: string[] = [];
const features = new FeatureSwitchesService(new ConfigService({}));
const service = new StudentIntakeService(features);
const students = new StudentsService();
const req = { ipAddress: null, userAgent: null };

async function makeSchool(name: string) {
  const school = await basePrisma.school.create({
    data: { name, slug: `intake-${randomUUID()}`, status: "ACTIVE", featureSwitches: { "student-intake": true } },
  });
  schoolIds.push(school.id);
  return withTenant(school.id, async (db) => {
    const mkUser = async (roleKey: string, permissions: string[]) => {
      const user = await db.user.create({ data: { schoolId: school.id, firstName: "Staff", lastName: roleKey } });
      const role = await db.role.upsert({
        where: { schoolId_key: { schoolId: school.id, key: roleKey } },
        create: { schoolId: school.id, key: roleKey, name: roleKey, permissions },
        update: {},
      });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return { auth: { schoolId: school.id, userId: user.id, sessionId: "test" } as AuthContext, roleId: role.id };
    };
    const admin = await mkUser("admin", ["student.create", "student.read"]);
    const otherAdmin = await mkUser("admin", []);
    const teacher = await mkUser("teacher", ["student.create"]);
    const year = await db.academicYear.create({ data: { schoolId: school.id, label: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") } });
    const term = await db.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "First Term", sequence: 1, isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2026-12-15") } });
    const nextTerm = await db.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "Second Term", sequence: 2, isCurrent: false, startDate: new Date("2027-01-05"), endDate: new Date("2027-04-10") } });
    const level = await db.classLevel.create({ data: { schoolId: school.id, name: "JSS 1", code: "jss1", orderIndex: 1, stage: "JSS" } });
    const arm = await db.classArm.create({ data: { schoolId: school.id, classLevelId: level.id, name: "JSS 1A", code: "a" } });
    const arm2 = await db.classArm.create({ data: { schoolId: school.id, classLevelId: level.id, name: "JSS 1B", code: "b", capacity: 1 } });
    return { schoolId: school.id, admin, otherAdmin, teacher, termId: term.id, nextTermId: nextTerm.id, armId: arm.id, arm2Id: arm2.id };
  }, { timeoutMs: 30_000 });
}

function rows(n: number, prefix = "Ada", typed?: (i: number) => string | undefined): PrepareStudentIntakeInput["students"] {
  return Array.from({ length: n }, (_, i) => ({
    firstName: `${prefix}${i}`,
    lastName: "Okafor",
    dateOfBirth: new Date(`2014-0${(i % 9) + 1}-1${i % 10}`),
    gender: i % 2 ? "FEMALE" : "MALE",
    ...(typed?.(i) ? { admissionNumber: typed(i) } : {}),
  }));
}

describe("student intake proposals against PostgreSQL", () => {
  let A: Awaited<ReturnType<typeof makeSchool>>;
  let B: Awaited<ReturnType<typeof makeSchool>>;

  beforeEach(async () => {
    A = await makeSchool("Intake A");
    B = await makeSchool("Intake B");
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
        await deleteSchoolRows(tx, id);
      }, { timeout: 60_000 });
    }
    await basePrisma.$disconnect();
  });

  const studentCount = (schoolId: string) => withTenant(schoolId, (db) => db.student.count({ where: { schoolId } }));
  const enrolCount = (schoolId: string) => withTenant(schoolId, (db) => db.enrollment.count({ where: { schoolId } }));
  const autoNumbering = (schoolId: string, format = "ADM/{YYYY}/{NNN}", order: "SCHOOL" | "CLASS" = "SCHOOL") =>
    basePrisma.school.update({ where: { id: schoolId }, data: { admissionNumberMode: "AUTO", admissionNumberFormat: format, admissionNumberOrder: order } });
  const enrol = (fx: typeof A, termId = fx.termId, classArmId = fx.armId) => ({ mode: "ENROL" as const, termId, classArmId });
  const prepare = (fx: typeof A, input: Omit<PrepareStudentIntakeInput, "clientRequestId"> & { clientRequestId?: string }, who = fx.admin.auth) =>
    service.prepare(who, { clientRequestId: input.clientRequestId ?? randomUUID(), placement: input.placement, students: input.students }, null);
  const confirm = (fx: typeof A, p: StudentIntakeProposalDto, who = fx.admin.auth) => service.confirm(who, p.id, p.previewHash, req);

  // ---------------------------------------------------------------------
  it("prepares an authoritative preview without writing, then confirms students and enrolments once", async () => {
    const p = await prepare(A, { placement: enrol(A), students: rows(3, "Ada", (i) => `T-${i}`) });
    expect(p).toMatchObject({
      status: "PENDING", canConfirm: true, dataCleared: false, outcome: null,
      placement: { mode: "ENROL", termId: A.termId, classArmId: A.armId, termLabel: "2026/2027 · First Term", classLabel: "JSS 1 · JSS 1A" },
      counts: { rows: 3, withErrors: 0, withWarnings: 0, assignedOnConfirm: 0 },
      batchErrors: [], batchWarnings: [],
    });
    expect(p.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.rows.map((r) => [r.admissionNumber, r.admissionNumberSource, r.values.dateOfBirth])).toEqual([
      ["T-0", "TYPED", "2014-01-10"], ["T-1", "TYPED", "2014-02-11"], ["T-2", "TYPED", "2014-03-12"],
    ]);
    expect(await studentCount(A.schoolId)).toBe(0);

    const done = await confirm(A, p);
    expect(done).toMatchObject({ status: "COMPLETED", rows: [], dataCleared: true, canConfirm: false });
    expect(done.outcome).toMatchObject({ createdCount: 3, enrolledCount: 3 });
    expect(done.outcome!.students.map((s) => s.admissionNumber)).toEqual(["T-0", "T-1", "T-2"]);
    expect(await studentCount(A.schoolId)).toBe(3);
    expect(await enrolCount(A.schoolId)).toBe(3);

    // Attribution: how it was added, not "assistant" and not "AI".
    const audits = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { schoolId: A.schoolId } }));
    const byAction = (a: string) => audits.filter((x) => x.action === a);
    expect(byAction("student.create")).toHaveLength(3);
    expect(byAction("enrollment.create")).toHaveLength(3);
    expect(byAction("student-intake.prepare")).toHaveLength(1);
    expect(byAction("student-intake.confirm")).toHaveLength(1);
    for (const a of [...byAction("student.create"), ...byAction("enrollment.create")]) {
      expect(a.metadata).toMatchObject({ via: "student-intake", proposalId: p.id });
    }
    expect(JSON.stringify(audits)).not.toMatch(/assistant|"ai"|Ada0|Okafor|2014-01-10/i);

    // The proposal row keeps no names or dates once completed.
    const [stored] = await withTenant(A.schoolId, (db) => db.$queryRaw<{ payload: unknown; summary: unknown; result: unknown }[]>`
      SELECT payload, summary, result FROM workflow_proposals WHERE id = ${p.id}`);
    expect(stored!.payload).toBeNull();
    expect(JSON.stringify(stored)).not.toMatch(/Ada|Okafor|2014-/);
  });

  it("DEFER creates students with no enrolment, and never sends invitations or calls a model", async () => {
    const p = await prepare(A, { placement: { mode: "DEFER" }, students: rows(2, "Bo", (i) => `D-${i}`) });
    expect(p.placement).toEqual({ mode: "DEFER" });
    const done = await confirm(A, p);
    expect(done.outcome).toMatchObject({ createdCount: 2, enrolledCount: 0 });
    expect(done.outcome!.students.every((s) => s.enrollmentId === null)).toBe(true);
    expect(await enrolCount(A.schoolId)).toBe(0);
    const side = await withTenant(A.schoolId, async (db) => ({
      guardianInvites: await db.guardianInvitation.count({ where: { schoolId: A.schoolId } }),
      staffInvites: await db.invitation.count({ where: { schoolId: A.schoolId } }),
      deliveries: await db.notificationDelivery.count({ where: { schoolId: A.schoolId } }),
      aiLogs: await db.aIInteractionLog.count({ where: { schoolId: A.schoolId } }),
      aiCalls: await db.aIGeneration.count({ where: { schoolId: A.schoolId } }),
    }));
    expect(side).toEqual({ guardianInvites: 0, staffInvites: 0, deliveries: 0, aiLogs: 0, aiCalls: 0 });
    // Nothing in the module can reach a model or a sender.
    for (const f of ["student-intake.service.ts", "student-intake-preview.ts", "student-intake.module.ts", "student-intake.controller.ts"]) {
      const imports = readFileSync(join(__dirname, f), "utf8").split("\n").filter((l) => /^import|from "/.test(l)).join("\n");
      expect(imports).not.toMatch(/@school-kit\/ai|AiGenerationService|AiModule"|anthropic|termii|resend|notification|invitation/i);
    }
  });

  // ---------------------------------------------------------------------
  it("is tenant-bound: another school cannot read or confirm, and cannot place into a foreign class or term", async () => {
    const p = await prepare(A, { placement: enrol(A), students: rows(1, "Cy", () => "X-1") });
    await expect(service.get(B.admin.auth, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.confirm(B.admin.auth, p.id, p.previewHash, req)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // B's admin names A's class and term: not found under B's RLS, so blocked.
    const foreign = await prepare(B, { placement: enrol(A), students: rows(1, "Cy", () => "X-1") });
    expect(foreign.canConfirm).toBe(false);
    expect(foreign.batchErrors.map((e) => e.code)).toEqual(["TERM_NOT_FOUND", "CLASS_ARM_NOT_FOUND"]);
    expect(foreign.placement).toMatchObject({ termLabel: null, classLabel: null });
    await expect(confirm(B, foreign)).rejects.toMatchObject({ code: "INTAKE_BLOCKED" });
    expect(await studentCount(A.schoolId)).toBe(0);
    expect(await studentCount(B.schoolId)).toBe(0);
  });

  it("only the requester can read, confirm or refresh; other staff see 404", async () => {
    const p = await prepare(A, { placement: enrol(A), students: rows(1, "Di", () => "R-1") });
    await expect(service.get(A.otherAdmin.auth, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(confirm(A, p, A.otherAdmin.auth)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.refresh(A.otherAdmin.auth, p.id, randomUUID(), null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await studentCount(A.schoolId)).toBe(0);
  });

  it("refuses a teacher even with student.create, and refuses missing permission, deactivation, suspension and the switch between prepare and confirm", async () => {
    await expect(prepare(A, { placement: enrol(A), students: rows(1) }, A.teacher.auth)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await prepare(A, { placement: enrol(A), students: rows(1, "Ed", () => "P-1") });

    await withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.admin.roleId }, data: { permissions: ["student.read"] } }));
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.admin.roleId }, data: { permissions: ["student.create"] } }));

    await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.admin.auth.userId }, data: { isActive: false } }));
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "USER_INACTIVE" });
    await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.admin.auth.userId }, data: { isActive: true } }));

    await basePrisma.school.update({ where: { id: A.schoolId }, data: { suspendedAt: new Date() } });
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { suspendedAt: null, featureSwitches: {} } });
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The outcome stays readable with the switch off; the proposal is still pending.
    expect((await service.get(A.admin.auth, p.id)).status).toBe("PENDING");
    expect(await studentCount(A.schoolId)).toBe(0);

    await basePrisma.school.update({ where: { id: A.schoolId }, data: { featureSwitches: { "student-intake": true } } });
    expect((await confirm(A, p)).status).toBe("COMPLETED");
  });

  // ---------------------------------------------------------------------
  it("invalid placement blocks; a class deactivated or a term deleted after prepare makes the preview stale", async () => {
    await withTenant(A.schoolId, (db) => db.classArm.update({ where: { id: A.arm2Id }, data: { isActive: false } }));
    const inactive = await prepare(A, { placement: enrol(A, A.termId, A.arm2Id), students: rows(1, "Fe", () => "I-1") });
    expect(inactive.batchErrors.map((e) => e.code)).toEqual(["CLASS_ARM_INACTIVE"]);
    expect(inactive.canConfirm).toBe(false);

    const p = await prepare(A, { placement: enrol(A), students: rows(1, "Fe", () => "I-2") });
    await withTenant(A.schoolId, (db) => db.classArm.update({ where: { id: A.armId }, data: { isActive: false } }));
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "INTAKE_PREVIEW_STALE" });
    expect(await studentCount(A.schoolId)).toBe(0);

    // Refresh shows why, and the old proposal can no longer be confirmed.
    const fresh = await service.refresh(A.admin.auth, p.id, randomUUID(), null);
    expect(fresh.batchErrors.map((e) => e.code)).toEqual(["CLASS_ARM_INACTIVE"]);
    expect(fresh.id).not.toBe(p.id);
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "INTAKE_EXPIRED" });
    expect((await service.get(A.admin.auth, p.id))).toMatchObject({ status: "EXPIRED", dataCleared: true, rows: [] });
  });

  it("warns, without blocking, on a non-current term, a full class, a future birth date and possible duplicates (disclosed rule)", async () => {
    await students.bulkCreate(A.admin.auth, { students: [{ firstName: "Ngozi ", lastName: "Éze", dateOfBirth: new Date("2013-04-04"), gender: "FEMALE", admissionNumber: "OLD-1" }] }, req);
    const future = new Date(Date.now() + 5 * 86_400_000);
    const p = await prepare(A, {
      placement: enrol(A, A.nextTermId, A.arm2Id),
      students: [
        { firstName: "ngozi", lastName: "Eze", dateOfBirth: new Date("2013-04-04"), gender: "FEMALE", admissionNumber: "N-1" },
        { firstName: "Tobi", lastName: "Ade", dateOfBirth: new Date("2012-01-01"), gender: "MALE", admissionNumber: "N-2" },
        { firstName: "TOBI", lastName: "ade", dateOfBirth: new Date("2012-01-01"), gender: "MALE", admissionNumber: "N-3" },
        { firstName: "Kemi", lastName: "Bello", dateOfBirth: future, gender: "FEMALE", admissionNumber: "N-4" },
      ],
    });
    expect(p.canConfirm).toBe(true);
    expect(p.batchErrors).toEqual([]);
    expect(p.batchWarnings.map((w) => w.code).sort()).toEqual(["CLASS_OVER_CAPACITY", "TERM_NOT_CURRENT"]);
    expect(p.batchWarnings.find((w) => w.code === "CLASS_OVER_CAPACITY")!.details).toEqual({ capacity: 1, enrolledNow: 0, afterIntake: 4 });
    expect(p.rows[0]!.warnings).toMatchObject([{ code: "POSSIBLE_DUPLICATE_ON_ROLL", relatedStudentIds: [expect.any(String)] }]);
    expect(p.rows[1]!.warnings).toMatchObject([{ code: "POSSIBLE_DUPLICATE_IN_BATCH", relatedIndexes: [2] }]);
    expect(p.rows[3]!.warnings.map((w) => w.code)).toEqual(["DATE_OF_BIRTH_IN_FUTURE"]);
    expect(p.counts).toMatchObject({ withWarnings: 4, withErrors: 0 });
    expect(p.duplicateRule).toMatch(/same first name, last name and date of birth/);
    // Nothing merged: four new students.
    expect((await confirm(A, p)).outcome!.createdCount).toBe(4);
    expect(await studentCount(A.schoolId)).toBe(5);
  });

  // ---------------------------------------------------------------------
  it("flags typed numbers repeated in the batch or already taken, and a number taken after prepare makes confirm stale", async () => {
    await students.bulkCreate(A.admin.auth, { students: [{ firstName: "X", lastName: "Y", dateOfBirth: new Date("2010-01-01"), gender: "MALE", admissionNumber: "TAKEN-1" }] }, req);
    const p = await prepare(A, { placement: { mode: "DEFER" }, students: rows(4, "Gi", (i) => ["TAKEN-1", "DUP", "DUP", "OK-1"][i]) });
    expect(p.rows.map((r) => r.errors.map((e) => e.code))).toEqual([["ADMISSION_NUMBER_TAKEN"], ["ADMISSION_NUMBER_REPEATED"], ["ADMISSION_NUMBER_REPEATED"], []]);
    expect(p.rows[1]!.errors[0]!.relatedIndexes).toEqual([2]);
    expect(p.canConfirm).toBe(false);
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "INTAKE_BLOCKED" });

    const q = await prepare(A, { placement: { mode: "DEFER" }, students: rows(1, "Gi", () => "LATER-1") });
    await students.bulkCreate(A.admin.auth, { students: [{ firstName: "Z", lastName: "Y", dateOfBirth: new Date("2010-01-01"), gender: "MALE", admissionNumber: "LATER-1" }] }, req);
    await expect(confirm(A, q)).rejects.toMatchObject({ code: "INTAKE_PREVIEW_STALE" });
    expect(await studentCount(A.schoolId)).toBe(2);
  });

  it("automatic numbers are not shown or reserved at prepare and are allocated without collision under concurrency", async () => {
    await autoNumbering(A.schoolId);
    const p1 = await prepare(A, { placement: enrol(A), students: rows(5, "Ha") });
    const p2 = await prepare(A, { placement: enrol(A), students: rows(5, "Ib") });
    for (const p of [p1, p2]) {
      expect(p.counts.assignedOnConfirm).toBe(5);
      expect(p.rows.every((r) => r.admissionNumber === null && r.admissionNumberSource === "ASSIGNED_ON_CONFIRM")).toBe(true);
    }
    const counters = await withTenant(A.schoolId, (db) => db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM admission_number_counters WHERE school_id = ${A.schoolId}`);
    expect(Number(counters[0]!.n)).toBe(0);
    // A bulk add in between moves the counter; the previews stay valid.
    await students.bulkCreate(A.admin.auth, { students: rows(2, "Mid") }, req);
    const [d1, d2] = await Promise.all([confirm(A, p1), confirm(A, p2)]);
    const numbers = [...d1.outcome!.students, ...d2.outcome!.students].map((s) => s.admissionNumber);
    expect(new Set(numbers).size).toBe(10);
    const all = await withTenant(A.schoolId, (db) => db.student.findMany({ where: { schoolId: A.schoolId }, select: { admissionNumber: true } }));
    expect(new Set(all.map((s) => s.admissionNumber)).size).toBe(12);
    expect(all.every((s) => /^ADM\/\d{4}\/\d{3}$/.test(s.admissionNumber))).toBe(true);
  });

  it("blank numbers need a class when the school numbers per class, and a number when it numbers by hand", async () => {
    const manual = await prepare(A, { placement: enrol(A), students: rows(1) });
    expect(manual.rows[0]!.errors.map((e) => e.code)).toEqual(["ADMISSION_NUMBER_REQUIRED"]);
    await autoNumbering(A.schoolId, "{CLASS}/{NNN}", "CLASS");
    const deferred = await prepare(A, { placement: { mode: "DEFER" }, students: rows(1) });
    expect(deferred.rows[0]!.errors.map((e) => e.code)).toEqual(["ADMISSION_NUMBER_NEEDS_CLASS"]);
    const placed = await prepare(A, { placement: enrol(A), students: rows(2) });
    expect(placed.canConfirm).toBe(true);
    expect((await confirm(A, placed)).outcome!.students.map((s) => s.admissionNumber)).toEqual(["JSS1/001", "JSS1/002"]);
    // Switching to typed numbers after prepare invalidates the preview.
    const p = await prepare(A, { placement: enrol(A), students: rows(1, "Ku") });
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { admissionNumberMode: "MANUAL", admissionNumberFormat: null } });
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "INTAKE_PREVIEW_STALE" });
  });

  // ---------------------------------------------------------------------
  it("two confirmations at once create exactly one set, and both callers get the same outcome", async () => {
    await autoNumbering(A.schoolId);
    const p = await prepare(A, { placement: enrol(A), students: rows(20, "Jo") });
    const results = await Promise.allSettled([confirm(A, p), confirm(A, p), confirm(A, p)]);
    const ok = results.filter((r): r is PromiseFulfilledResult<StudentIntakeProposalDto> => r.status === "fulfilled");
    expect(ok.length).toBe(3);
    expect(new Set(ok.map((r) => JSON.stringify(r.value.outcome))).size).toBe(1);
    expect(await studentCount(A.schoolId)).toBe(20);
    expect(await enrolCount(A.schoolId)).toBe(20);
  });

  it("prepare is idempotent on clientRequestId, and refuses the same id for a different batch", async () => {
    const clientRequestId = randomUUID();
    const input = { clientRequestId, placement: enrol(A), students: rows(2, "Ke", (i) => `K-${i}`) };
    const [a, b] = await Promise.all([prepare(A, input), prepare(A, input)]);
    expect(b.id).toBe(a.id);
    expect((await prepare(A, input)).id).toBe(a.id);
    await expect(prepare(A, { ...input, students: rows(3, "Ke", (i) => `K-${i}`) })).rejects.toMatchObject({ code: "INTAKE_REQUEST_ID_REUSED" });
    // The same id by another person is that person's own proposal.
    expect((await prepare(A, input, A.otherAdmin.auth)).id).not.toBe(a.id);
    // After confirming, the same prepare returns the completed outcome, not a new batch.
    const done = await confirm(A, a);
    expect(await prepare(A, input)).toMatchObject({ id: a.id, status: "COMPLETED", outcome: done.outcome });
    expect(await studentCount(A.schoolId)).toBe(2);
  });

  it("a committed confirm whose response is lost is recovered by GET and by repeating the confirm, with no second write", async () => {
    const p = await prepare(A, { placement: enrol(A), students: rows(3, "Lu", (i) => `L-${i}`) });
    // The transaction commits, then the response is lost on the way back.
    vi.spyOn(StudentIntakeService.prototype as unknown as { respond: () => never }, "respond").mockImplementationOnce(() => {
      throw new Error("socket hang up");
    });
    await expect(confirm(A, p)).rejects.toThrow("socket hang up");
    expect(await studentCount(A.schoolId)).toBe(3);
    const recovered = await service.get(A.admin.auth, p.id);
    expect(recovered).toMatchObject({ status: "COMPLETED", outcome: { createdCount: 3, enrolledCount: 3 } });
    const again = await confirm(A, p);
    expect(again.outcome).toEqual(recovered.outcome);
    expect(await studentCount(A.schoolId)).toBe(3);
    expect(await enrolCount(A.schoolId)).toBe(3);
  });

  it("a crash after the writes but before the completion marker commits nothing; the retry writes exactly once", async () => {
    await autoNumbering(A.schoolId);
    const p = await prepare(A, { placement: enrol(A), students: rows(4, "Mo") });
    const err = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    vi.spyOn(StudentIntakeService.prototype as unknown as { markCompleted: () => Promise<never> }, "markCompleted").mockRejectedValueOnce(
      new Error("process killed: Mo0 Okafor 2014-01-10"),
    );
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    // The log line names no row value.
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/Mo0|Okafor|2014/);
    expect(await studentCount(A.schoolId)).toBe(0);
    expect(await enrolCount(A.schoolId)).toBe(0);
    const audits = await withTenant(A.schoolId, (db) => db.auditLog.count({ where: { schoolId: A.schoolId, action: { in: ["student.create", "enrollment.create"] } } }));
    expect(audits).toBe(0);
    expect((await service.get(A.admin.auth, p.id)).status).toBe("PENDING");

    const done = await confirm(A, p);
    expect(done.outcome!.createdCount).toBe(4);
    // The counter rolled back with the crash: numbering continues from 001.
    expect(done.outcome!.students.map((s) => s.admissionNumber.slice(-3))).toEqual(["001", "002", "003", "004"]);
    expect(await studentCount(A.schoolId)).toBe(4);
  });

  // ---------------------------------------------------------------------
  it("expiry refuses confirm, clears the rows, and a forged fingerprint is refused before any write", async () => {
    const p = await prepare(A, { placement: enrol(A), students: rows(1, "Ny", () => "E-1") });
    await expect(service.confirm(A.admin.auth, p.id, "f".repeat(64), req)).rejects.toMatchObject({ code: "INTAKE_PREVIEW_MISMATCH" });
    await withTenant(A.schoolId, (db) => db.$executeRaw`UPDATE workflow_proposals SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = ${p.id}`);
    await expect(confirm(A, p)).rejects.toMatchObject({ code: "INTAKE_EXPIRED" });
    expect(await new StudentIntakeSweeperService().sweep(new Date())).toBeGreaterThanOrEqual(1);
    expect(await service.get(A.admin.auth, p.id)).toMatchObject({ status: "EXPIRED", dataCleared: true, rows: [] });
    await expect(service.refresh(A.admin.auth, p.id, randomUUID(), null)).rejects.toMatchObject({ code: "INTAKE_EXPIRED" });
    expect(await studentCount(A.schoolId)).toBe(0);
  });

  it("refresh is idempotent on its new id and refuses a confirmed proposal", async () => {
    const p = await prepare(A, { placement: enrol(A), students: rows(1, "Ob", () => "F-1") });
    const id = randomUUID();
    const r1 = await service.refresh(A.admin.auth, p.id, id, null);
    const r2 = await service.refresh(A.admin.auth, p.id, id, null);
    expect(r2.id).toBe(r1.id);
    await confirm(A, r1);
    await expect(service.refresh(A.admin.auth, r1.id, randomUUID(), null)).rejects.toMatchObject({ code: "INTAKE_ALREADY_CONFIRMED" });
  });

  it("the plan cap under enforcement is a batch error, not a partial write", async () => {
    const prev = process.env.PLAN_ENFORCEMENT;
    process.env.PLAN_ENFORCEMENT = "enforce";
    try {
      await basePrisma.school.update({ where: { id: A.schoolId }, data: { studentCapOverride: 2 } });
      const p = await prepare(A, { placement: enrol(A), students: rows(3, "Pa", (i) => `C-${i}`) });
      expect(p.batchErrors.map((e) => e.code)).toEqual(["PLAN_STUDENT_LIMIT"]);
      await expect(confirm(A, p)).rejects.toMatchObject({ code: "INTAKE_BLOCKED" });
      expect(await studentCount(A.schoolId)).toBe(0);
    } finally {
      process.env.PLAN_ENFORCEMENT = prev;
    }
  });

  it("POST /students/bulk keeps its contract: all-or-nothing 409 and plain bulk attribution", async () => {
    await expect(students.bulkCreate(A.admin.auth, { students: rows(2, "Qu", () => "SAME") }, req)).rejects.toMatchObject({
      code: "ADMISSION_NUMBERS_TAKEN", details: { rows: [{ index: 1, reason: "REPEATED_IN_REQUEST" }] },
    });
    expect(await studentCount(A.schoolId)).toBe(0);
    const res = await students.bulkCreate(A.admin.auth, { students: rows(2, "Qu", (i) => `B-${i}`), enrollment: { termId: A.termId, classArmId: A.armId } }, req);
    expect(res.created.map((s) => s.admissionNumber)).toEqual(["B-0", "B-1"]);
    const audits = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { schoolId: A.schoolId } }));
    expect(audits.filter((a) => a.action === "student.create").every((a) => (a.metadata as { via?: string }).via === "bulk")).toBe(true);
    expect(audits.filter((a) => a.action === "enrollment.create").every((a) => (a.metadata as { via?: string }).via === "student-bulk-create")).toBe(true);
    expect(await enrolCount(A.schoolId)).toBe(2);
  });
});
