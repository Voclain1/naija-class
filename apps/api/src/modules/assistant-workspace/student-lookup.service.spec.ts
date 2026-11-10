import { randomUUID } from "node:crypto";

import { basePrisma, withTenant } from "@school-kit/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteSchoolRows } from "../platform-admin/school-deletion";
import { StudentsService } from "../students/students.service";
import { TeacherScopeService } from "../teacher-scope/teacher-scope.service";
import { StudentLookupService } from "./student-lookup.service";

// Named student lookup (docs/modules/assistant-workspace.md, "Named student
// lookup") against real PostgreSQL: who may find whom, and how a name and a
// class become matches. No model is involved.

const schoolIds: string[] = [];
const lookup = new StudentLookupService(new StudentsService(), new TeacherScopeService());

async function school(label: string) {
  const s = await basePrisma.school.create({ data: { name: `Lookup ${label}`, slug: `lookup-${randomUUID()}`, status: "ACTIVE", featureSwitches: { "assistant-workspace": true } } });
  schoolIds.push(s.id);
  return withTenant(s.id, async (db) => {
    const user = async (key: string, permissions: string[]) => {
      const u = await db.user.create({ data: { schoolId: s.id, firstName: "Staff", lastName: key, isActive: true } });
      const role = await db.role.upsert({ where: { schoolId_key: { schoolId: s.id, key } }, create: { schoolId: s.id, key, name: key, permissions }, update: {} });
      await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      return { schoolId: s.id, userId: u.id, sessionId: "t", roleId: role.id };
    };
    const admin = await user("admin", ["student.read", "attendance.read", "report-card.read"]);
    const teacher = await user("teacher", ["student.read", "teacher-assignment.read", "attendance.read"]);
    const bursar = await user("bursar", ["finance.debtors.read"]);
    const year = await db.academicYear.create({ data: { schoolId: s.id, label: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") } });
    const term = await db.term.create({ data: { schoolId: s.id, academicYearId: year.id, name: "First Term", sequence: 1, isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2026-12-15") } });
    const jss2 = await db.classLevel.create({ data: { schoolId: s.id, name: "JSS 2", code: "jss2", orderIndex: 1, stage: "JSS" } });
    const jss3 = await db.classLevel.create({ data: { schoolId: s.id, name: "JSS 3", code: "jss3", orderIndex: 2, stage: "JSS" } });
    const arm = (level: { id: string }, name: string, code: string, classTeacherId?: string) => db.classArm.create({ data: { schoolId: s.id, classLevelId: level.id, name, code, classTeacherId } });
    const a2a = await arm(jss2, "JSS 2A", "2a", teacher.userId); // the teacher's own class
    const a2b = await arm(jss2, "JSS 2B", "2b");
    const a3a = await arm(jss3, "JSS 3A", "3a");
    const pupil = async (first: string, last: string, adm: string, armId: string) => {
      const st = await db.student.create({ data: { schoolId: s.id, firstName: first, lastName: last, admissionNumber: adm, dateOfBirth: new Date("2013-04-17"), gender: "MALE" } });
      await db.enrollment.create({ data: { schoolId: s.id, studentId: st.id, termId: term.id, academicYearId: year.id, classArmId: armId, status: "ENROLLED" } });
      return st;
    };
    const p = {
      samuelOkoro: await pupil("Samuel", "Okoro", `${label}-1`, a2a.id),
      samuelBello: await pupil("Samuel", "Bello", `${label}-2`, a2b.id),
      samuelMusa: await pupil("Samuel", "Musa", `${label}-3`, a3a.id),
      samuella: await pupil("Samuella", "Ade", `${label}-4`, a2a.id),
      chiamaka: await pupil("Chiamaka", "Obi", `${label}-5`, a2b.id),
    };
    return { schoolId: s.id, admin, teacher, bursar, termId: term.id, arms: { a2a, a2b, a3a }, p };
  }, { timeoutMs: 30_000 });
}

describe("named student lookup against PostgreSQL", () => {
  let A: Awaited<ReturnType<typeof school>>;
  let B: Awaited<ReturnType<typeof school>>;
  beforeAll(async () => { A = await school("A"); B = await school("B"); });
  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
      await deleteSchoolRows(tx, id);
    }, { timeout: 60_000 });
  });

  const ids = (r: { matches: { studentId: string }[] }) => r.matches.map((m) => m.studentId).sort();

  it("several Samuels in one level and across arms are a choice, never a guess; a class narrows them", async () => {
    const all = await lookup.find(A.admin, { name: "Samuel" });
    expect(all.status).toBe("several");
    expect(ids(all)).toEqual([A.p.samuelOkoro.id, A.p.samuelBello.id, A.p.samuelMusa.id].sort());
    expect(all.matches.map((m) => m.classLabel).sort()).toEqual(["JSS 2 · JSS 2A", "JSS 2 · JSS 2B", "JSS 3 · JSS 3A"]);
    // "Samuel in JSS 2" (the level's arms): still two.
    const jss2 = await lookup.find(A.admin, { name: "Samuel", classArmIds: [A.arms.a2a.id, A.arms.a2b.id] });
    expect(jss2.status).toBe("several");
    expect(ids(jss2)).toEqual([A.p.samuelOkoro.id, A.p.samuelBello.id].sort());
    // "Samuel in JSS 2A": one, and the full name narrows too.
    expect(await lookup.find(A.admin, { name: "Samuel", classArmIds: [A.arms.a2a.id] })).toMatchObject({ status: "found", matches: [{ studentId: A.p.samuelOkoro.id, match: "exact", name: "Samuel Okoro", termId: A.termId }] });
    expect((await lookup.find(A.admin, { name: "Samuel Bello" })).matches.map((m) => m.studentId)).toEqual([A.p.samuelBello.id]);
  });

  it("similar spellings are offered as 'similar', exact names win, and no match is 'none'", async () => {
    // "Samuella" is exact for her and does not pull in the Samuels.
    expect(await lookup.find(A.admin, { name: "Samuella" })).toMatchObject({ status: "found", matches: [{ studentId: A.p.samuella.id }] });
    // A misspelling: no exact match, close spellings marked similar.
    const typo = await lookup.find(A.admin, { name: "Chiamka" });
    expect(typo).toMatchObject({ status: "similar", matches: [{ studentId: A.p.chiamaka.id, match: "similar" }] });
    expect(await lookup.find(A.admin, { name: "Zebedee" })).toEqual({ status: "none", matches: [] });
    expect(await lookup.find(A.admin, { name: "Samuel", classArmIds: [randomUUID()] })).toEqual({ status: "none", matches: [] });
  });

  it("is tenant-bound: another school's matching names and forged ids are invisible", async () => {
    const r = await lookup.find(A.admin, { name: "Samuel" });
    expect(r.matches.every((m) => [A.p.samuelOkoro.id, A.p.samuelBello.id, A.p.samuelMusa.id].includes(m.studentId))).toBe(true);
    const described = await lookup.describe(A.admin, [B.p.samuelOkoro.id, A.p.samuelOkoro.id, randomUUID()]);
    expect([...described.keys()]).toEqual([A.p.samuelOkoro.id]);
  });

  it("teachers see only their own classes; other roles and missing permissions are refused; revocation and deactivation apply at once", async () => {
    const t = await lookup.find(A.teacher, { name: "Samuel" });
    expect(t).toMatchObject({ status: "found", matches: [{ studentId: A.p.samuelOkoro.id, classLabel: "JSS 2 · JSS 2A" }] });
    // A class outside their scope finds nothing (not "exists but not yours").
    expect(await lookup.find(A.teacher, { name: "Samuel", classArmIds: [A.arms.a2b.id] })).toEqual({ status: "none", matches: [] });
    expect([...(await lookup.describe(A.teacher, [A.p.samuelBello.id, A.p.samuelOkoro.id])).keys()]).toEqual([A.p.samuelOkoro.id]);
    await expect(lookup.find(A.bursar, { name: "Samuel" })).rejects.toMatchObject({ code: "STUDENT_LOOKUP_NOT_PERMITTED" });
    // Revoke student.read from the teacher: refused on the next call.
    await withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.teacher.roleId }, data: { permissions: ["teacher-assignment.read"] } }));
    await expect(lookup.find(A.teacher, { name: "Samuel" })).rejects.toMatchObject({ code: "STUDENT_LOOKUP_NOT_PERMITTED" });
    expect((await lookup.describe(A.teacher, [A.p.samuelOkoro.id])).size).toBe(0);
    // Deactivation.
    await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.admin.userId }, data: { isActive: false } }));
    await expect(lookup.find(A.admin, { name: "Samuel" })).rejects.toMatchObject({ code: "USER_INACTIVE" });
    await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.admin.userId }, data: { isActive: true } }));
  });
});
