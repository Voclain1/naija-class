import { expect, test } from "@playwright/test";

import { armId, assignTeacher, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// A teacher records a child's conduct from their own class list (pre-build
// audit, 2026-10-13). The API allowed it since #351; the only screen was the
// admin's student record, which a teacher cannot open.
test("a teacher writes a behaviour record for a child in their class", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Blue", code: `jss1-blue-${suffix}` }],
  });
  const classArmId = armId(structure, "JSS 1 Blue");
  const child = await apiCreateStudent(admin.api, {
    admissionNumber: `TB/${suffix}/1`,
    firstName: "Kemi",
    lastName: "Adewale",
    dateOfBirth: "2013-02-11T00:00:00.000Z",
    gender: "FEMALE",
  });
  await apiCreateEnrollment(admin.api, { studentId: child.id, termId: structure.termId, classArmId });

  const invited = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  await invited.context.close();
  await assignTeacher(admin.api, {
    teacherId: invited.userId,
    classArmId,
    subjectId: structure.subjectId,
    academicYearId: structure.academicYearId,
  });

  const teacher = await loginAsTeacher(browser, invited.email, invited.password);
  try {
    const page = teacher.page;
    await page.goto(`/teacher/classes/${classArmId}`);
    await page.getByRole("link", { name: "Adewale, Kemi" }).click();
    await expect(page.getByRole("heading", { name: "Kemi Adewale" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Nothing recorded yet.")).toBeVisible();

    await page.getByLabel("Concern").check();
    await page.getByPlaceholder("Write it as you would say it to a colleague.").fill("Left the lab without permission.");
    await page.getByRole("button", { name: "Save record" }).click();

    await expect(page.getByText("Left the lab without permission.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("0 commendations · 1 concern")).toBeVisible();
  } finally {
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
