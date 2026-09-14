import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { createApiContext, inviteAndAcceptTeacher, loginAsAdmin, loginAsTeacher, uniqueSuffix } from "../fixtures/index.js";

// Phase 8 / CP3 — the timetable builder's conflict-resolution flow, end to end.
// Plan-first: docs/modules/phase-8.md §17.6 item 9.
//
// FIXTURE (written directly): a current academic year with one current term;
// two classes; one subject; ONE teacher, Tunde Bello, assigned to that subject in
// BOTH classes for the whole year.
//
// THE FLOW, all through the UI:
//   1. the owner sets a bell schedule (Period 1, Period 2) in Settings;
//   2. builds class A's whole-year timetable: Tunde on Monday Period 1;
//   3. tries Tunde on Monday Period 1 for class B → sees the clash naming
//      class A, and nothing is saved;
//   4. moves the lesson to Period 2 in the same dialog → saved.
// The database is checked after steps 3 and 4 — the page is not trusted alone.
// A teacher is refused the timetable API (owner/admin only in CP3).

const SHOTS = "test-results/timetable-builder";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("owner sets a bell schedule, hits a real clash naming the other class, moves the lesson and saves", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const classA = `JSS 1A ${suffix}`;
  const classB = `JSS 1B ${suffix}`;
  const subjectName = `Mathematics ${suffix}`;

  const fx = await withTenant(admin.schoolId, async (db) => {
    await db.term.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    await db.academicYear.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    const year = await db.academicYear.create({
      data: { schoolId: admin.schoolId, label: `E2E-TT-${suffix}`, startDate: d("2026-09-07"), endDate: d("2027-07-23"), isCurrent: true },
      select: { id: true },
    });
    const term = await db.term.create({
      data: { schoolId: admin.schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: d("2026-09-07"), endDate: d("2026-12-11"), isCurrent: true },
      select: { id: true },
    });
    const level = await db.classLevel.findFirst({ where: { schoolId: admin.schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
    const armA = await db.classArm.create({ data: { schoolId: admin.schoolId, classLevelId: level!.id, name: classA, code: `tta-${suffix}` }, select: { id: true } });
    const armB = await db.classArm.create({ data: { schoolId: admin.schoolId, classLevelId: level!.id, name: classB, code: `ttb-${suffix}` }, select: { id: true } });
    const subject = await db.subject.create({ data: { schoolId: admin.schoolId, name: subjectName, code: `ttm-${suffix}` }, select: { id: true } });
    const role = await db.role.findFirst({ where: { schoolId: null, key: "teacher", isSystem: true }, select: { id: true } });
    const tunde = await db.user.create({
      data: { schoolId: admin.schoolId, firstName: "Tunde", lastName: "Bello", email: `e2e-tunde-${suffix}@school-kit.test`, passwordHash: "argon2id$placeholder" },
      select: { id: true },
    });
    await db.userRole.create({ data: { userId: tunde.id, roleId: role!.id } });
    await db.teacherAssignment.createMany({
      data: [armA.id, armB.id].map((classArmId) => ({
        schoolId: admin.schoolId, teacherId: tunde.id, classArmId, subjectId: subject.id, academicYearId: year.id, termId: null,
      })),
    });
    return { termId: term.id, armA: armA.id, armB: armB.id, tunde: tunde.id };
  });

  const lessonsIn = (classArmId: string) =>
    withTenant(admin.schoolId, (db) =>
      db.timetableEntry.findMany({
        where: { timetable: { classArmId } },
        select: { dayOfWeek: true, bellSlot: { select: { label: true } }, teachers: { select: { teacherId: true } } },
      }),
    );

  const teacher = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  const teacherSession = await loginAsTeacher(browser, teacher.email, teacher.password);
  const teacherApi = await createApiContext(teacherSession.token);

  try {
    const page = admin.page;

    // ---- 1. Bell schedule, through Settings --------------------------------
    await page.goto("/settings");
    await page.getByRole("link", { name: /Bell schedule/ }).click();
    await expect(page.getByRole("heading", { name: "Bell schedule", level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("No periods yet.")).toBeVisible();
    await page.getByRole("button", { name: "Add period" }).click();
    await page.getByRole("button", { name: "Add period" }).click();
    await expect(page.getByLabel("Period 1 name")).toHaveValue("Period 1");
    await expect(page.getByLabel("Period 1 start")).toHaveValue("08:00");
    await expect(page.getByLabel("Period 2 name")).toHaveValue("Period 2");
    await expect(page.getByLabel("Period 2 start")).toHaveValue("08:40");
    await page.getByRole("button", { name: "Save bell schedule" }).click();
    await expect(page.getByText("Bell schedule saved.")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/1-bell-schedule.png`, fullPage: true });

    // ---- 2. Class A: whole-year timetable, Tunde on Monday Period 1 --------
    await page.getByRole("link", { name: "Timetable" }).first().click();
    await expect(page.getByRole("heading", { name: "Timetable", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Class").selectOption({ label: classA });
    await page.getByRole("button", { name: "Create whole-year timetable" }).click();
    await page.getByRole("button", { name: "Monday Period 1: add lesson" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Subject").selectOption({ label: subjectName });
    await dialog.getByRole("checkbox", { name: "Tunde Bello" }).check();
    await dialog.getByRole("button", { name: "Save lesson" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `Monday Period 1: ${subjectName}` })).toContainText("Tunde Bello");
    await page.screenshot({ path: `${SHOTS}/2-class-a-built.png`, fullPage: true });

    // ---- 3. Class B: the same slot → a clash naming class A ----------------
    // Let class A's "Timetable saved." toast clear first, so the clash screenshot
    // cannot be misread as a save.
    await expect(page.getByText("Timetable saved.")).toHaveCount(0, { timeout: 15_000 });
    await page.getByLabel("Class").selectOption({ label: classB });
    await page.getByRole("button", { name: "Create whole-year timetable" }).click();
    await page.getByRole("button", { name: "Monday Period 1: add lesson" }).click();
    await dialog.getByLabel("Subject").selectOption({ label: subjectName });
    await dialog.getByRole("checkbox", { name: "Tunde Bello" }).check();
    await dialog.getByRole("button", { name: "Save lesson" }).click();

    const clash = dialog.getByRole("alert").filter({ hasText: "Timetable clash — nothing was saved" });
    await expect(clash).toBeVisible();
    await expect(clash).toContainText(`Tunde Bello already teaches ${classA} on Monday, Period 1 (First Term).`);
    await page.screenshot({ path: `${SHOTS}/3-clash-names-class-a.png`, fullPage: true });
    expect(await lessonsIn(fx.armB)).toEqual([]); // nothing saved for B

    // ---- 4. Move it to Period 2 in the same dialog → saved -----------------
    await dialog.getByLabel("Period").selectOption({ label: "Period 2" });
    await dialog.getByRole("button", { name: "Save lesson" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `Monday Period 2: ${subjectName}` })).toContainText("Tunde Bello");
    await expect(page.getByRole("button", { name: "Monday Period 1: add lesson" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/4-moved-and-saved.png`, fullPage: true });

    expect(await lessonsIn(fx.armB)).toEqual([{ dayOfWeek: 1, bellSlot: { label: "Period 2" }, teachers: [{ teacherId: fx.tunde }] }]);
    expect(await lessonsIn(fx.armA)).toEqual([{ dayOfWeek: 1, bellSlot: { label: "Period 1" }, teachers: [{ teacherId: fx.tunde }] }]);
    const refusedAudits = await withTenant(admin.schoolId, (db) => db.auditLog.count({ where: { action: "timetable.lesson.save" } }));
    expect(refusedAudits).toBe(2); // A's save and B's Period-2 save; the refused clash wrote none

    // ---- 5. A teacher is refused (owner/admin only in CP3) -----------------
    for (const path of ["timetable/bell-schedule", `timetable/view?classArmId=${fx.armA}&termId=${fx.termId}`]) {
      expect((await teacherApi.get(path)).status(), path).toBe(403);
    }
  } finally {
    await teacherApi.dispose();
    await teacherSession.context.close();
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
