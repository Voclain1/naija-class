import { expect, test, type Page } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { createPortalGuardian, PORTAL_BASE_URL, type PortalGuardian } from "../fixtures/guardian.js";
import { inviteAndAcceptTeacher, loginAsAdmin, loginAsTeacher, uniqueSuffix } from "../fixtures/index.js";

// Phase 8 / CP4 — publishing, the family and teacher read surfaces, and copy.
// Plan-first: docs/modules/phase-8.md §18.6 item 8.
//
// FIXTURE (API + direct writes, so every name on screen is known):
//   current year with First Term (current) and Second Term; a NEXT year with one term;
//   JSS 1A (the teacher is its FORM teacher) and JSS 1B; Mathematics;
//   teacher Tunde Teacher, assigned Maths in both classes THIS year only;
//   a guardian whose child is enrolled in JSS 1A this term;
//   bell schedule Period 1, Period 2; JSS 1A: Mon P1; JSS 1B: Tue P2.
//
// THE FLOW:
//   1. admin publishes JSS 1A → the guardian sees Monday P1 in the portal;
//   2. admin adds Wednesday P2 → builder says "Unpublished changes"; the guardian
//      STILL sees only Monday; the database shows the edit exists;
//   3. admin publishes the changes → the guardian now sees Wednesday too;
//   4. the teacher opens My timetable → own lessons across both classes, plus
//      JSS 1A's grid as form class, and no JSS 1B grid;
//   5. admin checks a copy of JSS 1A into next year → refused, naming the teacher
//      who is not assigned there; the assignment is added; checked again → ready;
//      copied → the database shows next year's JSS 1A timetable with 2 lessons.

const SHOTS = "test-results/timetable-publish-and-reads";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function guardianTimetable(page: Page, guardian: PortalGuardian): Promise<void> {
  await page.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}/timetable`);
  await expect(page.getByRole("heading", { name: "Class timetable" })).toBeVisible({ timeout: 60_000 });
}

test("publish is what families see; an unpublished edit stays invisible until republished; teacher view; copy refusal fixed then copied", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const classA = `JSS 1A ${suffix}`;
  const classB = `JSS 1B ${suffix}`;
  const subjectName = `Mathematics ${suffix}`;

  const teacher = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId, firstName: "Tunde", lastName: "Teacher" });
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });

  const fx = await withTenant(admin.schoolId, async (db) => {
    await db.term.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    await db.academicYear.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    const year = await db.academicYear.create({ data: { schoolId: admin.schoolId, label: `E2E-PUB-${suffix}`, startDate: d("2026-09-07"), endDate: d("2027-07-23"), isCurrent: true }, select: { id: true } });
    const first = await db.term.create({ data: { schoolId: admin.schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: d("2026-09-07"), endDate: d("2026-12-11"), isCurrent: true }, select: { id: true } });
    await db.term.create({ data: { schoolId: admin.schoolId, academicYearId: year.id, sequence: 2, name: "Second Term", startDate: d("2027-01-11"), endDate: d("2027-04-02") } });
    const next = await db.academicYear.create({ data: { schoolId: admin.schoolId, label: `E2E-NEXT-${suffix}`, startDate: d("2027-09-06"), endDate: d("2028-07-21") }, select: { id: true } });
    await db.term.create({ data: { schoolId: admin.schoolId, academicYearId: next.id, sequence: 1, name: "First Term", startDate: d("2027-09-06"), endDate: d("2027-12-10") } });
    const level = await db.classLevel.findFirst({ where: { schoolId: admin.schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
    const armA = await db.classArm.create({ data: { schoolId: admin.schoolId, classLevelId: level!.id, name: classA, code: `pa-${suffix}`, classTeacherId: teacher.userId }, select: { id: true } });
    const armB = await db.classArm.create({ data: { schoolId: admin.schoolId, classLevelId: level!.id, name: classB, code: `pb-${suffix}` }, select: { id: true } });
    const subject = await db.subject.create({ data: { schoolId: admin.schoolId, name: subjectName, code: `pm-${suffix}` }, select: { id: true } });
    await db.teacherAssignment.createMany({
      data: [armA.id, armB.id].map((classArmId) => ({ schoolId: admin.schoolId, teacherId: teacher.userId, classArmId, subjectId: subject.id, academicYearId: year.id })),
    });
    await db.enrollment.create({ data: { schoolId: admin.schoolId, studentId: guardian.studentId, termId: first.id, academicYearId: year.id, classArmId: armA.id } });
    return { yearId: year.id, nextYearId: next.id, armA: armA.id, armB: armB.id, subjectId: subject.id };
  });

  const ok = async (res: import("@playwright/test").APIResponse) => {
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  };
  const schedule = await ok(await admin.api.put("timetable/bell-schedule", {
    data: {
      slots: [
        { label: "Period 1", kind: "LESSON", startMinute: 480, endMinute: 520 },
        { label: "Period 2", kind: "LESSON", startMinute: 520, endMinute: 560 },
      ],
      schoolWeekDays: [1, 2, 3, 4, 5],
    },
  }));
  const [p1, p2] = (schedule as { slots: Array<{ id: string }> }).slots.map((s) => s.id);
  const ttA = await ok(await admin.api.post("timetable/timetables", { data: { classArmId: fx.armA, academicYearId: fx.yearId, termId: null } }));
  const ttB = await ok(await admin.api.post("timetable/timetables", { data: { classArmId: fx.armB, academicYearId: fx.yearId, termId: null } }));
  await ok(await admin.api.put("timetable/lessons", { data: { timetableId: ttA.id, dayOfWeek: 1, bellSlotId: p1, subjectId: fx.subjectId, teacherIds: [teacher.userId], span: 1 } }));
  await ok(await admin.api.put("timetable/lessons", { data: { timetableId: ttB.id, dayOfWeek: 2, bellSlotId: p2, subjectId: fx.subjectId, teacherIds: [teacher.userId], span: 1 } }));

  const guardianContext = await browser.newContext();
  const gPage = await guardianContext.newPage();
  const teacherSession = await loginAsTeacher(browser, teacher.email, teacher.password);
  const page = admin.page;
  const panel = page.getByRole("region", { name: "What families see" });

  try {
    // ---- 0. Guardian signs in; nothing is published yet --------------------
    await gPage.goto(`${PORTAL_BASE_URL}/login`);
    await gPage.getByLabel("Email").fill(guardian.email);
    await gPage.getByLabel("Password", { exact: true }).fill(guardian.password);
    await gPage.getByRole("button", { name: "Log in" }).click();
    await expect(gPage.getByRole("heading", { name: "Your children" })).toBeVisible();
    await guardianTimetable(gPage, guardian);
    await expect(gPage.getByText(`The school hasn't published a timetable for ${classA} yet.`)).toBeVisible();

    // ---- 1. Admin publishes JSS 1A -------------------------------------------
    await page.goto("/timetable");
    await expect(page.getByRole("heading", { name: "Timetable", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Class").selectOption({ label: classA });
    await expect(panel.getByRole("status")).toContainText("Not published");
    await panel.getByRole("button", { name: "Publish" }).click();
    await expect(panel.getByRole("status")).toContainText("students and parents see exactly this");
    await page.screenshot({ path: `${SHOTS}/1-published.png`, fullPage: true });

    await guardianTimetable(gPage, guardian);
    const monday = gPage.getByRole("region", { name: "Monday" });
    await expect(monday).toContainText(subjectName);
    await expect(monday).toContainText("Tunde Teacher");
    await expect(gPage.getByRole("region", { name: "Wednesday" })).not.toContainText(subjectName);
    await gPage.screenshot({ path: `${SHOTS}/2-guardian-sees-published.png`, fullPage: true });

    // ---- 2. Admin adds Wednesday P2 — unpublished ----------------------------
    await page.getByRole("button", { name: "Wednesday Period 2: add lesson" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Subject").selectOption({ label: subjectName });
    await dialog.getByRole("checkbox", { name: "Tunde Teacher" }).check();
    await dialog.getByRole("button", { name: "Save lesson" }).click();
    await expect(dialog).toBeHidden();
    await expect(panel.getByRole("status")).toContainText("Unpublished changes — students and parents still see the version published on");
    await page.screenshot({ path: `${SHOTS}/3-unpublished-changes.png`, fullPage: true });

    const lessonsA = await withTenant(admin.schoolId, (db) => db.timetableEntry.count({ where: { timetableId: ttA.id } }));
    expect(lessonsA).toBe(2); // the edit is real…
    await gPage.reload();
    await expect(gPage.getByRole("heading", { name: "Class timetable" })).toBeVisible();
    await expect(gPage.getByRole("region", { name: "Wednesday" })).not.toContainText(subjectName); // …and invisible to families
    await gPage.screenshot({ path: `${SHOTS}/4-guardian-still-sees-published.png`, fullPage: true });

    // ---- 3. Publish the changes ----------------------------------------------
    await panel.getByRole("button", { name: "Publish changes" }).click();
    await expect(panel.getByRole("status")).toContainText("students and parents see exactly this");
    await gPage.reload();
    await expect(gPage.getByRole("region", { name: "Wednesday" })).toContainText(subjectName);

    // ---- 4. Teacher: own lessons + form class only ---------------------------
    await teacherSession.page.goto("/teacher/timetable");
    const tPage = teacherSession.page;
    await expect(tPage.getByRole("heading", { name: "My timetable", level: 1 })).toBeVisible({ timeout: 60_000 });
    const mine = tPage.getByRole("region", { name: "My lessons" });
    // The week grid pairs a subject with its class by POSITION — the class
    // sits under the subject in the same cell — so there is no longer a
    // "Subject — Class" string to match. The day view still writes that line,
    // and both views are checked here: the week for both classes appearing at
    // all, the day for the pairing itself.
    await expect(mine).toContainText(subjectName);
    await expect(mine).toContainText(classA);
    await expect(mine).toContainText(classB);
    await mine.getByRole("button", { name: "Day", exact: true }).click();
    // The day view opens on today, which is whatever day CI runs on; the
    // lesson under test is on Wednesday (see the guardian assertion above).
    await mine.getByRole("button", { name: "Wed", exact: true }).click();
    await expect(mine).toContainText(`${subjectName} — `);
    await expect(tPage.getByRole("heading", { name: `${classA} — your form class` })).toBeVisible();
    await expect(tPage.getByRole("heading", { name: `${classB} — your form class` })).toHaveCount(0);
    await tPage.screenshot({ path: `${SHOTS}/5-teacher-my-timetable.png`, fullPage: true });

    // ---- 5. Copy into next year: refused, fixed, copied ----------------------
    await page.getByRole("button", { name: "Copy to another term or year…" }).click();
    const copy = page.getByRole("dialog");
    await copy.getByLabel("Copy to year").selectOption({ label: `E2E-NEXT-${suffix}` });
    await copy.getByLabel("Copy to term").selectOption({ label: "Whole year" });
    await copy.getByRole("button", { name: "Check copy" }).click();
    const refusal = copy.getByRole("alert").filter({ hasText: "This copy can't be made yet" });
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(`Tunde Teacher is not assigned to teach ${subjectName} here — Monday Period 1.`);
    await expect(refusal).toContainText(`Tunde Teacher is not assigned to teach ${subjectName} here — Wednesday Period 2.`);
    await expect(copy.getByRole("button", { name: "Copy", exact: true })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/6-copy-refused.png`, fullPage: true });
    expect(await withTenant(admin.schoolId, (db) => db.timetable.count({ where: { academicYearId: fx.nextYearId } }))).toBe(0);

    await withTenant(admin.schoolId, (db) =>
      db.teacherAssignment.create({ data: { schoolId: admin.schoolId, teacherId: teacher.userId, classArmId: fx.armA, subjectId: fx.subjectId, academicYearId: fx.nextYearId } }),
    );
    await copy.getByRole("button", { name: "Check copy" }).click();
    await expect(copy.getByRole("status")).toContainText("Ready: 2 lessons will be copied.");
    await copy.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.getByText("Copied 2 lessons. Not published yet.")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/7-copied.png`, fullPage: true });

    const copied = await withTenant(admin.schoolId, (db) =>
      db.timetable.findFirst({ where: { classArmId: fx.armA, academicYearId: fx.nextYearId, termId: null }, select: { _count: { select: { entries: true } } } }),
    );
    expect(copied?._count.entries).toBe(2);
    // A copy is never published on its own.
    expect(await withTenant(admin.schoolId, (db) => db.timetablePublication.count({ where: { classArmId: fx.armA } }))).toBe(2); // this year's two terms only
  } finally {
    await guardianContext.close();
    await teacherSession.context.close();
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
