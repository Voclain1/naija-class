import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { basePrisma, withTenant } from "@school-kit/db";
import { prepareStudentCorrectionsSchema, type PrepareStudentCorrectionsInput, type StudentCorrectionProposalDto } from "@school-kit/types";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../../common/auth/auth-context";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service";
import { deleteSchoolRows } from "../platform-admin/school-deletion";
import { StudentsService } from "../students/students.service";
import { StudentCorrectionsService } from "./student-corrections.service";

// Real PostgreSQL, as app_user under RLS (docs/modules/student-corrections.md).

const schoolIds: string[] = [];
const service = new StudentCorrectionsService(new FeatureSwitchesService(new ConfigService({})));
const students = new StudentsService();
const req = { ipAddress: null, userAgent: null };

async function makeSchool(name: string) {
  const school = await basePrisma.school.create({
    data: { name, slug: `corr-${randomUUID()}`, status: "ACTIVE", featureSwitches: { "student-corrections": true } },
  });
  schoolIds.push(school.id);
  return withTenant(school.id, async (db) => {
    const mkUser = async (key: string, permissions: string[]) => {
      const user = await db.user.create({ data: { schoolId: school.id, firstName: "Staff", lastName: key } });
      const role = await db.role.upsert({
        where: { schoolId_key: { schoolId: school.id, key } },
        create: { schoolId: school.id, key, name: key, permissions },
        update: {},
      });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return { auth: { schoolId: school.id, userId: user.id, sessionId: "t" } as AuthContext, roleId: role.id };
    };
    const admin = await mkUser("admin", ["student.read", "student.update"]);
    const otherAdmin = await mkUser("admin", []);
    const teacher = await mkUser("teacher", ["student.read", "student.update"]);
    const mk = (first: string, n: string, extra: Record<string, unknown> = {}) =>
      db.student.create({
        data: { schoolId: school.id, firstName: first, middleName: "Mid", lastName: "Okafor", admissionNumber: n, dateOfBirth: new Date("2014-03-12"), gender: "FEMALE", email: `${n.toLowerCase()}@example.test`, address: "1 School Road", ...extra },
      });
    const ada = await mk("Ada", "C1");
    const bo = await mk("Bo", "C2", { middleName: null, email: null });
    const gone = await mk("Gone", "C3", { status: "WITHDRAWN", withdrawnAt: new Date() });
    return { schoolId: school.id, admin, otherAdmin, teacher, ada, bo, gone };
  }, { timeoutMs: 30_000 });
}

describe("reviewed student corrections against PostgreSQL", () => {
  let A: Awaited<ReturnType<typeof makeSchool>>;
  let B: Awaited<ReturnType<typeof makeSchool>>;

  beforeEach(async () => {
    A = await makeSchool("Corrections A");
    B = await makeSchool("Corrections B");
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

  const parse = (corrections: unknown) => prepareStudentCorrectionsSchema.parse({ clientRequestId: randomUUID(), corrections });
  const prepare = (corrections: unknown, who = A.admin.auth) => service.prepare(who, parse(corrections), null);
  const confirm = (p: StudentCorrectionProposalDto, who = A.admin.auth) => service.confirm(who, p.id, p.previewHash, null);
  const read = (id: string) => withTenant(A.schoolId, (db) => db.student.findUniqueOrThrow({ where: { id } }));
  const audits = () => withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { schoolId: A.schoolId, action: "student.update" } }));

  // ---------------------------------------------------------------------
  it("previews named before/after by id: SET, CLEAR and SAME, absent fields untouched, and writes nothing", async () => {
    const p = await prepare([
      { studentId: A.ada.id, changes: { firstName: "Adaeze", middleName: null, email: null, gender: "FEMALE" } },
      { studentId: A.bo.id, changes: { dateOfBirth: "2013-01-05", email: "Bo.New@Example.test" } },
    ]);
    expect(p).toMatchObject({ status: "PENDING", canConfirm: true, counts: { rows: 2, toUpdate: 2, fieldChanges: 5, clears: 2, withErrors: 0 } });
    expect(p.rows[0]).toMatchObject({ studentId: A.ada.id, current: { name: "Ada Mid Okafor", admissionNumber: "C1", status: "ACTIVE" } });
    expect(p.rows[0]!.fields).toEqual([
      { field: "firstName", before: "Ada", after: "Adaeze", change: "SET" },
      { field: "middleName", before: "Mid", after: null, change: "CLEAR" },
      { field: "gender", before: "FEMALE", after: "FEMALE", change: "SAME" },
      { field: "email", before: "c1@example.test", after: null, change: "CLEAR" },
    ]);
    expect(p.rows[1]!.fields).toEqual([
      { field: "dateOfBirth", before: "2014-03-12", after: "2013-01-05", change: "SET" },
      { field: "email", before: null, after: "bo.new@example.test", change: "SET" },
    ]);
    expect((await read(A.ada.id)).firstName).toBe("Ada");
  });

  it("applies the batch atomically with attributed audits and its marker, leaving every other field alone", async () => {
    const p = await prepare([
      { studentId: A.ada.id, changes: { firstName: "Adaeze", middleName: null, email: null } },
      { studentId: A.bo.id, changes: { gender: "MALE", dateOfBirth: "2013-01-05" } },
    ]);
    const done = await confirm(p);
    expect(done).toMatchObject({ status: "COMPLETED", rows: [], dataCleared: true, canConfirm: false });
    expect(done.outcome).toEqual({ updatedCount: 2, students: [
      { studentId: A.ada.id, changed: ["firstName", "middleName", "email"] },
      { studentId: A.bo.id, changed: ["dateOfBirth", "gender"] },
    ] });
    const ada = await read(A.ada.id);
    expect(ada).toMatchObject({ firstName: "Adaeze", middleName: null, lastName: "Okafor", email: null, admissionNumber: "C1", status: "ACTIVE", address: "1 School Road", gender: "FEMALE" });
    const bo = await read(A.bo.id);
    expect(bo.gender).toBe("MALE");
    expect(bo.dateOfBirth.toISOString().slice(0, 10)).toBe("2013-01-05");
    const a = await audits();
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.metadata)).toEqual(expect.arrayContaining([
      { changed: ["firstName", "middleName", "email"], via: "student-corrections", proposalId: p.id },
      { changed: ["dateOfBirth", "gender"], via: "student-corrections", proposalId: p.id },
    ]));
    // No values anywhere outside the student rows themselves.
    const stored = await withTenant(A.schoolId, async (db) => ({
      proposal: await db.$queryRaw`SELECT payload, summary, result FROM workflow_proposals WHERE id = ${p.id}`,
      audits: await db.auditLog.findMany({ where: { schoolId: A.schoolId } }),
      ai: await db.aIInteractionLog.count({ where: { schoolId: A.schoolId } }),
    }));
    expect(JSON.stringify(stored)).not.toMatch(/Adaeze|Okafor|2013-01-05|example\.test/);
    expect(stored.ai).toBe(0);
  });

  it("is tenant-bound and requester-only", async () => {
    const p = await prepare([{ studentId: A.ada.id, changes: { firstName: "X" } }]);
    await expect(service.get(B.admin.auth, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(confirm(p, B.admin.auth)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.otherAdmin.roleId }, data: { permissions: ["student.read", "student.update"] } }));
    await expect(service.get(A.otherAdmin.auth, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // School B naming A's student: not found under B's RLS, so blocked.
    const foreign = await prepare([{ studentId: A.ada.id, changes: { firstName: "X" } }], B.admin.auth);
    expect(foreign.rows[0]).toMatchObject({ current: null, errors: [{ code: "STUDENT_NOT_FOUND" }] });
    await expect(confirm(foreign, B.admin.auth)).rejects.toMatchObject({ code: "CORRECTION_BLOCKED" });
    expect((await read(A.ada.id)).firstName).toBe("Ada");
  });

  it("refuses a teacher, and a confirm after permission revocation, deactivation, suspension or the switch going off", async () => {
    await expect(prepare([{ studentId: A.ada.id, changes: { firstName: "X" } }], A.teacher.auth)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await prepare([{ studentId: A.ada.id, changes: { firstName: "Adaeze" } }]);
    for (const [apply, undo, code] of [
      [() => withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.admin.roleId }, data: { permissions: ["student.update"] } })),
       () => withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.admin.roleId }, data: { permissions: ["student.read", "student.update"] } })), "FORBIDDEN"],
      [() => withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.admin.auth.userId }, data: { isActive: false } })),
       () => withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.admin.auth.userId }, data: { isActive: true } })), "USER_INACTIVE"],
      [() => basePrisma.school.update({ where: { id: A.schoolId }, data: { suspendedAt: new Date() } }),
       () => basePrisma.school.update({ where: { id: A.schoolId }, data: { suspendedAt: null } }), "FORBIDDEN"],
      [() => basePrisma.school.update({ where: { id: A.schoolId }, data: { featureSwitches: {} } }),
       () => basePrisma.school.update({ where: { id: A.schoolId }, data: { featureSwitches: { "student-corrections": true } } }), "FORBIDDEN"],
    ] as const) {
      await apply();
      await expect(confirm(p)).rejects.toMatchObject({ code });
      expect((await read(A.ada.id)).firstName).toBe("Ada");
      await undo();
    }
    expect((await service.get(A.admin.auth, p.id)).status).toBe("PENDING");
    expect((await confirm(p)).status).toBe("COMPLETED");
  });

  it("rejects a stale preview when a shown value changed, but not for an unrelated field; refresh shows the new state", async () => {
    const p = await prepare([{ studentId: A.ada.id, changes: { firstName: "Adaeze" } }]);
    await students.update(A.admin.auth, A.ada.id, { address: "2 New Road" }, req); // not shown: still valid
    const q = await prepare([{ studentId: A.bo.id, changes: { lastName: "Eze" } }]);
    await students.update(A.admin.auth, A.bo.id, { lastName: "Bello" }, req); // shown: stale
    await expect(confirm(q)).rejects.toMatchObject({ code: "CORRECTION_PREVIEW_STALE" });
    const fresh = await service.refresh(A.admin.auth, q.id, randomUUID(), null);
    expect(fresh.rows[0]!.fields[0]).toEqual({ field: "lastName", before: "Bello", after: "Eze", change: "SET" });
    await expect(confirm(q)).rejects.toMatchObject({ code: "CORRECTION_EXPIRED" });
    expect((await confirm(fresh)).outcome!.updatedCount).toBe(1);
    expect((await confirm(p)).outcome!.updatedCount).toBe(1);
    expect(await read(A.ada.id)).toMatchObject({ firstName: "Adaeze", address: "2 New Road" });
    // A status change is part of the reviewed state too.
    const r = await prepare([{ studentId: A.gone.id, changes: { firstName: "Gwen" } }]);
    expect(r.rows[0]!.warnings.map((w) => w.code)).toEqual(["STUDENT_NOT_ACTIVE"]);
    await students.reactivate(A.admin.auth, A.gone.id, {}, req);
    await expect(confirm(r)).rejects.toMatchObject({ code: "CORRECTION_PREVIEW_STALE" });
  });

  it("validates patches: shape at the boundary, values in the preview", async () => {
    const bad = (corrections: unknown) => prepareStudentCorrectionsSchema.safeParse({ clientRequestId: randomUUID(), corrections }).success;
    expect(bad([{ studentId: A.ada.id, changes: {} }])).toBe(false);
    expect(bad([{ studentId: A.ada.id, changes: { firstName: null } }])).toBe(false); // required fields cannot be cleared
    expect(bad([{ studentId: A.ada.id, changes: { lastName: "  " } }])).toBe(false);
    expect(bad([{ studentId: A.ada.id, changes: { dateOfBirth: "2014-02-30" } }])).toBe(false);
    expect(bad([{ studentId: A.ada.id, changes: { email: "not-an-email" } }])).toBe(false);
    for (const field of ["admissionNumber", "status", "address", "phone", "notes"]) {
      expect(bad([{ studentId: A.ada.id, changes: { [field]: "x" } }])).toBe(false);
    }
    expect(bad([{ studentId: A.ada.id, changes: { firstName: "a" } }, { studentId: A.ada.id, changes: { lastName: "b" } }])).toBe(false);
    expect(bad(Array.from({ length: 101 }, () => ({ studentId: randomUUID(), changes: { firstName: "x" } })))).toBe(false);
    expect(bad([{ studentId: A.ada.id, changes: { middleName: null, email: null } }])).toBe(true);

    await withTenant(B.schoolId, (db) => db.student.create({ data: { schoolId: B.schoolId, firstName: "Other", lastName: "School", admissionNumber: "X", dateOfBirth: new Date("2012-01-01"), gender: "MALE", email: "shared@example.test" } }));
    await withTenant(A.schoolId, (db) => db.student.update({ where: { id: A.gone.id }, data: { email: "shared@example.test" } }));
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const p = await prepare([
      { studentId: A.ada.id, changes: { dateOfBirth: future } },
      { studentId: A.bo.id, changes: { dateOfBirth: "1990-01-01", email: "SHARED@example.test" } },
      { studentId: A.gone.id, changes: { firstName: "Gone", lastName: "Okafor" } },
    ]);
    expect(p.rows.map((r) => r.errors.map((e) => e.code))).toEqual([["DATE_OF_BIRTH_IN_FUTURE"], [], []]);
    // EMAIL_SHARED counts this school only (B's student is invisible).
    expect(p.rows.map((r) => r.warnings.map((w) => w.code))).toEqual([[], ["DATE_OF_BIRTH_UNUSUAL", "EMAIL_SHARED"], ["STUDENT_NOT_ACTIVE", "NO_CHANGE"]]);
    expect(p.canConfirm).toBe(false);
    await expect(confirm(p)).rejects.toMatchObject({ code: "CORRECTION_BLOCKED" });
    const nothing = await prepare([{ studentId: A.ada.id, changes: { firstName: "Ada" } }]);
    expect(nothing.batchErrors.map((e) => e.code)).toEqual(["NOTHING_TO_APPLY"]);
    expect(await audits()).toHaveLength(0);
  });

  it("two confirmations at once apply once; two batches on the same student cannot both apply", async () => {
    const p = await prepare([{ studentId: A.ada.id, changes: { firstName: "Adaeze" } }, { studentId: A.bo.id, changes: { firstName: "Bola" } }]);
    const results = await Promise.all([confirm(p), confirm(p), confirm(p)]);
    expect(new Set(results.map((r) => JSON.stringify(r.outcome))).size).toBe(1);
    expect(await audits()).toHaveLength(2);

    const x = await prepare([{ studentId: A.ada.id, changes: { lastName: "One" } }]);
    const y = await prepare([{ studentId: A.ada.id, changes: { lastName: "Two" } }, { studentId: A.bo.id, changes: { lastName: "Two" } }]);
    const settled = await Promise.allSettled([confirm(x), confirm(y)]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(settled.find((s) => s.status === "rejected")).toMatchObject({ reason: { code: "CORRECTION_PREVIEW_STALE" } });
    const ada = await read(A.ada.id);
    const bo = await read(A.bo.id);
    // All of the winning batch, none of the losing one.
    expect(ada.lastName === "One" ? bo.lastName : ada.lastName).toBe(ada.lastName === "One" ? "Okafor" : "Two");
  });

  it("rolls everything back when the transaction fails before its marker; the retry applies once", async () => {
    const p = await prepare([{ studentId: A.ada.id, changes: { firstName: "Adaeze" } }, { studentId: A.bo.id, changes: { firstName: "Bola" } }]);
    const err = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    vi.spyOn(StudentCorrectionsService.prototype as unknown as { markCompleted: () => Promise<never> }, "markCompleted").mockRejectedValueOnce(new Error("crash: Adaeze"));
    await expect(confirm(p)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/Adaeze/);
    expect((await read(A.ada.id)).firstName).toBe("Ada");
    expect((await read(A.bo.id)).firstName).toBe("Bo");
    expect(await audits()).toHaveLength(0);
    expect((await service.get(A.admin.auth, p.id)).status).toBe("PENDING");
    expect((await confirm(p)).outcome!.updatedCount).toBe(2);
    expect(await audits()).toHaveLength(2);
  });

  it("a lost response after commit is recovered by GET and by repeating the confirm, with no second write", async () => {
    const p = await prepare([{ studentId: A.ada.id, changes: { email: "new@example.test" } }]);
    vi.spyOn(StudentCorrectionsService.prototype as unknown as { respond: () => never }, "respond").mockImplementationOnce(() => {
      throw new Error("socket hang up");
    });
    await expect(confirm(p)).rejects.toThrow("socket hang up");
    expect((await read(A.ada.id)).email).toBe("new@example.test");
    const got = await service.get(A.admin.auth, p.id);
    expect(got).toMatchObject({ status: "COMPLETED", outcome: { updatedCount: 1 } });
    expect((await confirm(p)).outcome).toEqual(got.outcome);
    expect(await audits()).toHaveLength(1);
  });

  it("prepare is idempotent on clientRequestId and refuses the id for a different batch; refresh of an applied batch is refused", async () => {
    const body: PrepareStudentCorrectionsInput = parse([{ studentId: A.ada.id, changes: { firstName: "Adaeze" } }]);
    const [a, b] = await Promise.all([service.prepare(A.admin.auth, body, null), service.prepare(A.admin.auth, body, null)]);
    expect(b.id).toBe(a.id);
    await expect(service.prepare(A.admin.auth, { ...body, corrections: [{ studentId: A.ada.id, changes: { firstName: "Other" } }] }, null)).rejects.toMatchObject({ code: "CORRECTION_REQUEST_ID_REUSED" });
    await confirm(a);
    expect(await service.prepare(A.admin.auth, body, null)).toMatchObject({ id: a.id, status: "COMPLETED" });
    await expect(service.refresh(A.admin.auth, a.id, randomUUID(), null)).rejects.toMatchObject({ code: "CORRECTION_ALREADY_CONFIRMED" });
    // Expiry clears the values and refuses confirm.
    const e = await prepare([{ studentId: A.bo.id, changes: { firstName: "Bola" } }]);
    await withTenant(A.schoolId, (db) => db.$executeRaw`UPDATE workflow_proposals SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = ${e.id}`);
    await expect(confirm(e)).rejects.toMatchObject({ code: "CORRECTION_EXPIRED" });
    expect(await service.get(A.admin.auth, e.id)).toMatchObject({ status: "EXPIRED", dataCleared: true, rows: [] });
  });

  it("leaves PATCH /students/:id unchanged and the module free of model imports", async () => {
    const updated = await students.update(A.admin.auth, A.ada.id, { firstName: "Patched", middleName: null }, req);
    expect(updated.firstName).toBe("Patched");
    const [a] = await audits();
    expect(a!.metadata).toEqual({ changed: ["firstName", "middleName"] });
    for (const f of ["student-corrections.service.ts", "student-corrections-preview.ts", "student-corrections.module.ts", "student-corrections.controller.ts"]) {
      const imports = readFileSync(join(__dirname, f), "utf8").split("\n").filter((l) => /from "/.test(l)).join("\n");
      expect(imports).not.toMatch(/@school-kit\/ai|AiGenerationService|common\/ai/);
    }
  });
});
