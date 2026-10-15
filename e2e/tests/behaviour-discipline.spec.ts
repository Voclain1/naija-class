import { expect, test } from "@playwright/test";

import { armId, assignTeacher, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP2.3 — discipline (docs/modules/phase-9.md §9 CP2-D3, CP2-D4).
// Through the real UI: a teacher proposes a suspension for a child in their
// class, the owner approves it from the decisions queue, and the child's
// guardian sees the notice in the parent portal — the action and its dates,
// never the reason.
test("a teacher proposes a suspension, the owner approves, and the guardian sees the notice", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const reason = `Fought at break ${suffix}`;
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 3 Gold", code: `jss3-gold-${suffix}` }],
  });
  const classArmId = armId(structure, "JSS 3 Gold");
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  await apiCreateEnrollment(admin.api, { studentId: guardian.studentId, termId: structure.termId, classArmId });

  const invited = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  await invited.context.close();
  await assignTeacher(admin.api, {
    teacherId: invited.userId,
    classArmId,
    subjectId: structure.subjectId,
    academicYearId: structure.academicYearId,
  });

  const teacher = await loginAsTeacher(browser, invited.email, invited.password);
  const parentContext = await browser.newContext();
  try {
    // 1. The teacher proposes.
    const page = teacher.page;
    await page.goto(`/teacher/classes/${classArmId}`);
    await page.getByRole("link", { name: "Adeleke, Chidinma" }).click();
    await expect(page.getByRole("heading", { name: "Chidinma Adeleke" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("No discipline actions.")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Action").selectOption("SUSPENSION");
    await page.getByLabel("First day").fill("2026-11-02");
    await page.getByLabel("Last day").fill("2026-11-04");
    await page.getByLabel("Reason (staff only)").fill(reason);
    await page.getByRole("button", { name: "Propose action" }).click();
    const proposed = page.getByRole("listitem").filter({ hasText: reason });
    await expect(proposed).toContainText("Waiting for a decision", { timeout: 30_000 });
    // A teacher never decides.
    await expect(proposed.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // 2. The owner approves from the queue.
    const owner = admin.page;
    await owner.goto("/behaviour");
    await expect(owner.getByRole("heading", { name: "Waiting for a decision" })).toBeVisible({ timeout: 60_000 });
    const row = owner.getByRole("listitem").filter({ hasText: reason });
    await expect(row).toContainText("Chidinma Adeleke");
    owner.once("dialog", (dialog) => void dialog.accept());
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(owner.getByRole("listitem").filter({ hasText: reason })).toHaveCount(0, { timeout: 30_000 });

    // 3. The guardian sees the notice, and not the reason.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByRole("heading", { name: "Notices from the school" })).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText("Suspended from 2 Nov to 4 Nov 2026")).toBeVisible();
    await expect(parent.getByText("Please contact the school.", { exact: true })).toBeVisible();
    await expect(parent.getByText(reason)).toHaveCount(0);
  } finally {
    await parentContext.close();
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
