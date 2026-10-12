import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AuthService } from "../auth/auth.service";
import { AdmissionNumberSettingsService } from "../schools/admission-number-settings.service";
import { admissionYear, assignAdmissionNumbers, loadNumbering } from "./admission-numbers";
import { StudentsService } from "./students.service";

// Admission numbers assigned by SchoolKit (docs/modules/admission-numbers.md).
// Real database, real RLS: the counters are a FORCE-RLS table and the counts
// are taken with an upsert inside the student-create transaction.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23487${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("admission numbers", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const students = new StudentsService();
  const settings = new AdmissionNumberSettingsService();
  const schoolIds = new Set<string>();
  const year = admissionYear();

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  async function school(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Admission ${suffix}`,
        schoolSlug: `adm-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `adm-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return {
      schoolId: signed.school.id,
      authCtx: { sessionId: "sess", userId: signed.user.id, schoolId: signed.school.id },
    };
  }

  async function withArm(schoolId: string, suffix: string) {
    return withTenant(schoolId, async (db) => {
      const ay = await db.academicYear.create({
        data: { schoolId, label: `2025/26-${suffix}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: ay.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
          isCurrent: true,
        },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: `${level.name} A`, code: `${level.code}-a-${suffix}` },
      });
      return { termId: term.id, classArmId: arm.id, levelCode: level.code.toUpperCase() };
    });
  }

  const kid = (n: string, extra: Record<string, unknown> = {}) => ({
    firstName: `Kid ${n}`,
    lastName: "Learner",
    dateOfBirth: new Date("2014-03-15"),
    gender: "FEMALE" as const,
    ...extra,
  });

  it("a school that types its numbers is told to type one", async () => {
    const { authCtx } = await school("manual");
    await expect(students.create(authCtx, kid("a"), reqCtx)).rejects.toMatchObject({ code: "ADMISSION_NUMBER_REQUIRED" });
  });

  it("in order across the school: blanks get the next numbers; a typed number is kept", async () => {
    const { authCtx } = await school("order");
    const saved = await settings.update(authCtx, { mode: "AUTO", format: "VFM/{YYYY}/{NNNN}", order: "SCHOOL" }, reqCtx);
    expect(saved).toMatchObject({ mode: "AUTO", decided: true, nextNumber: `VFM/${year}/0001` });

    const a = await students.create(authCtx, kid("a"), reqCtx);
    const b = await students.create(authCtx, kid("b"), reqCtx);
    const typed = await students.create(authCtx, kid("c", { admissionNumber: "OLD-77" }), reqCtx);
    expect([a.admissionNumber, b.admissionNumber, typed.admissionNumber]).toEqual([
      `VFM/${year}/0001`,
      `VFM/${year}/0002`,
      "OLD-77",
    ]);
    expect((await settings.get(authCtx)).nextNumber).toBe(`VFM/${year}/0003`);
  });

  it("carries on from the register, and steps over a number already typed in the way", async () => {
    const { authCtx } = await school("carry");
    await students.create(authCtx, kid("x", { admissionNumber: `SJC/${year}/0147` }), reqCtx);
    await settings.update(authCtx, { mode: "AUTO", format: "SJC/{YYYY}/{NNNN}", order: "SCHOOL" }, reqCtx);
    expect((await students.create(authCtx, kid("a"), reqCtx)).admissionNumber).toBe(`SJC/${year}/0148`);

    await students.create(authCtx, kid("y", { admissionNumber: `SJC/${year}/0149` }), reqCtx);
    expect((await students.create(authCtx, kid("b"), reqCtx)).admissionNumber).toBe(`SJC/${year}/0150`);
  });

  it("the bulk add numbers its blank rows in row order, around the typed ones", async () => {
    const { authCtx } = await school("bulk");
    await settings.update(authCtx, { mode: "AUTO", format: "{NNN}-B", order: "SCHOOL" }, reqCtx);
    const { created } = await students.bulkCreate(
      authCtx,
      { students: [kid("1"), kid("2", { admissionNumber: "001-B" }), kid("3"), kid("4")] },
      reqCtx,
    );
    // 001-B was typed, so the count steps over it.
    expect(created.map((c) => c.admissionNumber)).toEqual(["002-B", "001-B", "003-B", "004-B"]);
  });

  it("per class: needs a class, and each class keeps its own count with its code in the number", async () => {
    const { authCtx, schoolId } = await school("class");
    const { termId, classArmId, levelCode } = await withArm(schoolId, "c");
    await settings.update(authCtx, { mode: "AUTO", format: "VF/{CLASS}/{NNN}", order: "CLASS" }, reqCtx);

    await expect(students.create(authCtx, kid("a"), reqCtx)).rejects.toMatchObject({ code: "ADMISSION_NUMBER_NEEDS_CLASS" });

    const one = await students.create(authCtx, kid("a", { enrollment: { termId, classArmId } }), reqCtx);
    const { created } = await students.bulkCreate(authCtx, { students: [kid("b"), kid("c")], enrollment: { termId, classArmId } }, reqCtx);
    expect([one.admissionNumber, ...created.map((c) => c.admissionNumber)]).toEqual([
      `VF/${levelCode}/001`,
      `VF/${levelCode}/002`,
      `VF/${levelCode}/003`,
    ]);
    // The bulk add placed its students in the class too.
    const placed = await withTenant(schoolId, (db) => db.enrollment.count({ where: { classArmId } }));
    expect(placed).toBe(3);
  });

  it("random: the digits are random, the right length, and never repeat", async () => {
    const { authCtx } = await school("random");
    await settings.update(authCtx, { mode: "AUTO", format: "R{YY}{NNNNN}", order: "RANDOM" }, reqCtx);
    const { created } = await students.bulkCreate(authCtx, { students: Array.from({ length: 30 }, (_, i) => kid(String(i))) }, reqCtx);
    const numbers = created.map((c) => c.admissionNumber);
    const short = String(year % 100).padStart(2, "0");
    for (const n of numbers) expect(n).toMatch(new RegExp(`^R${short}\\d{5}$`));
    expect(new Set(numbers).size).toBe(30);
  });

  it("two adds at the same moment never share a number", async () => {
    const { authCtx } = await school("race");
    await settings.update(authCtx, { mode: "AUTO", format: "Q{NNNN}", order: "SCHOOL" }, reqCtx);
    const made = await Promise.all(Array.from({ length: 6 }, (_, i) => students.create(authCtx, kid(String(i)), reqCtx)));
    expect(made.map((m) => m.admissionNumber).sort()).toEqual(["Q0001", "Q0002", "Q0003", "Q0004", "Q0005", "Q0006"]);
  });

  it("an add that fails uses up no number, and a year in the format restarts the count", async () => {
    const { authCtx, schoolId } = await school("rollback");
    await settings.update(authCtx, { mode: "AUTO", format: "Z/{YYYY}/{NNN}", order: "SCHOOL" }, reqCtx);
    await withTenant(schoolId, async (db) => {
      const numbering = (await loadNumbering(db, schoolId))!;
      await assignAdmissionNumbers(db, schoolId, numbering, [{}, {}]);
      throw new Error("roll back");
    }).catch(() => undefined);
    expect((await students.create(authCtx, kid("a"), reqCtx)).admissionNumber).toBe(`Z/${year}/001`);

    const next = await withTenant(schoolId, async (db) =>
      assignAdmissionNumbers(db, schoolId, (await loadNumbering(db, schoolId))!, [{}], { year: year + 1 }),
    );
    expect(next).toEqual([`Z/${year + 1}/001`]);
  });

  it("a school can switch back to typing, keeping its format for later", async () => {
    const { authCtx } = await school("back");
    await settings.update(authCtx, { mode: "AUTO", format: "K{NNN}", order: "SCHOOL" }, reqCtx);
    const typing = await settings.update(authCtx, { mode: "MANUAL" }, reqCtx);
    expect(typing).toMatchObject({ mode: "MANUAL", format: "K{NNN}", nextNumber: null });
    await expect(students.create(authCtx, kid("a"), reqCtx)).rejects.toMatchObject({ code: "ADMISSION_NUMBER_REQUIRED" });
  });

  it("another school's counters are not visible (RLS)", async () => {
    const a = await school("rlsA");
    const b = await school("rlsB");
    await settings.update(a.authCtx, { mode: "AUTO", format: "A{NNN}", order: "SCHOOL" }, reqCtx);
    await students.create(a.authCtx, kid("1"), reqCtx);
    const seenByB = await withTenant(b.schoolId, (db) => db.admissionNumberCounter.count());
    expect(seenByB).toBe(0);
  });
});
