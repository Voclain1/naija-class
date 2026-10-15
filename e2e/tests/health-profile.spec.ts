import { expect, test } from "@playwright/test";

import { armId, assignTeacher, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP3.1 — health records (docs/modules/phase-9.md §10). Through the
// real UI: the health officer writes a child's record and a note for
// teachers; a teacher of the child sees the note and nothing else; the
// child's parent sees the whole record in the portal.
test("the health officer records a profile; the teacher sees only the note; the parent sees the record", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const allergy = `Severe peanut allergy ${suffix}`;
  const note = `EpiPen in her school bag ${suffix}`;
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 1 Green", code: `jss1-green-${suffix}` }] });
  const classArmId = armId(structure, "JSS 1 Green");
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  await apiCreateEnrollment(admin.api, { studentId: guardian.studentId, termId: structure.termId, classArmId });

  const officer = await inviteAndAcceptTeacher(browser, {
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
    firstName: "Halima",
    lastName: "Officer",
    roleKey: "health_officer",
  });
  const invited = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  await invited.context.close();
  await assignTeacher(admin.api, { teacherId: invited.userId, classArmId, subjectId: structure.subjectId, academicYearId: structure.academicYearId });

  const teacher = await loginAsTeacher(browser, invited.email, invited.password);
  const parentContext = await browser.newContext();
  try {
    // 1. The health officer finds the child and writes the record.
    const page = officer.page;
    await page.goto("/health");
    await expect(page.getByRole("heading", { name: "Health", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.getByPlaceholder("Name or admission number").fill("Chidinma");
    await page.getByRole("link", { name: /Chidinma Adeleke/ }).click();
    await expect(page.getByText("Nothing recorded yet.")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Add health record" }).click();
    await page.getByLabel("Allergies").fill(allergy);
    await page.getByLabel("Blood group").fill("O+");
    await page.getByLabel("For teachers").fill(note);
    await page.getByRole("button", { name: "Save health record" }).click();
    await expect(page.getByText(allergy)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Last changed by Halima Officer")).toBeVisible();

    // 2. The teacher sees the note, and not the allergy as recorded.
    const t = teacher.page;
    await t.goto(`/teacher/classes/${classArmId}`);
    await expect(t.getByText("Health notes (1)")).toBeVisible({ timeout: 60_000 });
    await expect(t.getByText(note)).toBeVisible();
    await t.getByRole("link", { name: "Adeleke, Chidinma" }).click();
    await expect(t.getByText("Health note", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(t.getByText(note)).toBeVisible();
    await expect(t.getByText(allergy)).toHaveCount(0);

    // 3. The parent sees the whole record.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByRole("heading", { name: "Health record" })).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText(allergy)).toBeVisible();
    await expect(parent.getByText(note)).toBeVisible();
  } finally {
    await parentContext.close();
    await teacher.context.close();
    await officer.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
