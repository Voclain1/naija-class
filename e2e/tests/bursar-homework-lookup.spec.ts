import { expect, test } from "@playwright/test";

import { addDays, lagosTodayIso } from "@school-kit/types";

import { seedTeacherInvitation } from "../fixtures/db.js";
import {
  armId,
  assignTeacher,
  createApiContext,
  inviteAndAcceptTeacher,
  loginAsAdmin,
  loginAsTeacher,
  setupAcademicStructure,
  uniqueSuffix,
  openFromMenu,
} from "../fixtures/index.js";

// A bursar looks up a class's homework at the counter (pre-build audit,
// 2026-10-14). They have held homework.read since the feature shipped, so they
// could answer a parent, but no screen showed it to them.
test("a bursar looks up what a class has been set", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 3 Green", code: `jss3-green-${suffix}` }],
  });
  const classArmId = armId(structure, "JSS 3 Green");

  const invited = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  await invited.context.close();
  await assignTeacher(admin.api, {
    teacherId: invited.userId,
    classArmId,
    subjectId: structure.subjectId,
    academicYearId: structure.academicYearId,
  });
  const teacher = await loginAsTeacher(browser, invited.email, invited.password);
  const teacherApi = await createApiContext(teacher.token);
  const set = await teacherApi.post("homework", {
    data: {
      classArmId,
      subjectId: structure.subjectId,
      title: `Exercise 4 ${suffix}`,
      instructions: "Questions 1 to 10.",
      dueDate: addDays(lagosTodayIso(), 2),
    },
  });
  expect(set.ok()).toBe(true);
  await teacherApi.dispose();
  await teacher.context.close();

  const bursarEmail = `e2e-bursar-hw-${suffix}@school-kit.test`;
  const { rawToken } = await seedTeacherInvitation({
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
    email: bursarEmail,
    firstName: "Bisi",
    lastName: "Bursar",
    roleKey: "bursar",
  });
  const anon = await createApiContext();
  const accepted = await anon.post(`invitations/${rawToken}/accept`, {
    data: { firstName: "Bisi", lastName: "Bursar", password: "Password1!", ndprConsent: true },
  });
  expect(accepted.ok()).toBe(true);
  await anon.dispose();

  const bursar = await loginAsTeacher(browser, bursarEmail, "Password1!");
  try {
    const page = bursar.page;
    await page.goto("/finance/dashboard");
    await openFromMenu(page, "Homework");
    await expect(page.getByRole("heading", { name: "Homework", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Class").selectOption({ label: "JSS 3 Green" });
    await expect(page.getByText(`Exercise 4 ${suffix}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Questions 1 to 10.")).toBeVisible();
    // Read only: nothing on the page sets or withdraws work.
    await expect(page.getByRole("button", { name: /withdraw|set homework/i })).toHaveCount(0);
  } finally {
    await bursar.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
