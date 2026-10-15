import { expect, test } from "@playwright/test";

import { armId, assignTeacher, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP2.1 — behaviour points (docs/modules/phase-9.md §9 CP2-D1).
// Through the real UI:
//   1. The owner adds two categories in Settings → Behaviour and turns points
//      on.
//   2. A teacher records a commendation for a child in their class with a
//      category, and the child's term total shows it.
// The fixture's current term is 2025-09-01 to 2025-12-15, so the record is
// dated inside it.
test("the owner sets up behaviour points and a teacher scores a child", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Gold", code: `jss1-gold-${suffix}` }],
  });
  const classArmId = armId(structure, "JSS 1 Gold");
  const child = await apiCreateStudent(admin.api, {
    admissionNumber: `BP/${suffix}/1`,
    firstName: "Tobi",
    lastName: "Okafor",
    dateOfBirth: "2013-02-11T00:00:00.000Z",
    gender: "MALE",
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

  const helping = `Helping others ${suffix}`;
  try {
    // ---- 1. Settings → Behaviour -------------------------------------------
    const page = admin.page;
    await page.goto("/settings/behaviour");
    await expect(page.getByRole("heading", { name: "Behaviour points", level: 1 })).toBeVisible({ timeout: 60_000 });

    await page.getByLabel("Name").fill(helping);
    await page.getByLabel("Points added").fill("2");
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.getByText(helping, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Commendation · +2 points")).toBeVisible();

    await page.getByLabel("Concern").check();
    await page.getByLabel("Name").fill(`Late to class ${suffix}`);
    await page.getByLabel("Points taken away").fill("1");
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.getByText("Concern · −1 point")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("switch", { name: "Use behaviour points" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Behaviour points are on.")).toBeVisible({ timeout: 30_000 });

    // ---- 2. The teacher scores a child -------------------------------------
    const teacher = await loginAsTeacher(browser, invited.email, invited.password);
    try {
      const tpage = teacher.page;
      await tpage.goto(`/teacher/classes/${classArmId}`);
      await tpage.getByRole("link", { name: "Okafor, Tobi" }).click();
      await expect(tpage.getByRole("heading", { name: "Tobi Okafor" })).toBeVisible({ timeout: 60_000 });

      await tpage.getByLabel("Category (optional)").selectOption({ label: `${helping} (+2)` });
      await tpage.getByPlaceholder("Write it as you would say it to a colleague.").fill("Helped a new pupil find the lab.");
      await tpage.getByLabel("When it happened").fill("2025-10-01");
      await tpage.getByRole("button", { name: "Save record" }).click();

      await expect(tpage.getByText("Helped a new pupil find the lab.")).toBeVisible({ timeout: 30_000 });
      await expect(tpage.getByRole("listitem").filter({ hasText: "Helped a new pupil" })).toContainText(`${helping} (+2)`);
      await expect(tpage.getByText("+2 points this term")).toBeVisible();
    } finally {
      await teacher.context.close();
    }
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
