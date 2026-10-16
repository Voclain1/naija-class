import { expect, test } from "@playwright/test";
import { basePrisma, withTenant } from "@school-kit/db";
import { addDaysIso, lagosTodayIso } from "@school-kit/types";

import { armId, assignTeacher, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian } from "../fixtures/guardian.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP4b — AI drafts of marking feedback are OPTIONAL
// (docs/modules/phase-9.md §12). Through the real UI:
//   1. the owner finds the school's switch, off by default, and turns it on;
//   2. with the platform's AI switch off for the school, a teacher sees no
//      "Draft with AI" anywhere and marks by hand exactly as before.
// The drafting itself (names removed, ids-only jobs, a draft never a mark) is
// covered against real Postgres in assignment-feedback.service.spec.ts with
// the model faked; CI has no AI key, so no real draft can be made here.
test("the owner switches AI drafts on; without the platform's AI a teacher marks by hand as before", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const title = `Plants essay ${suffix}`;
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 2 Gold", code: `j2a-${suffix}` }] });
  const classArmId = armId(structure, "JSS 2 Gold");
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
  try {
    // 1. The owner's switch: off by default, then on.
    const owner = admin.page;
    await owner.goto("/settings");
    await owner.getByRole("link", { name: /AI marking drafts/ }).click();
    await expect(owner.getByRole("heading", { name: "AI marking drafts" })).toBeVisible({ timeout: 60_000 });
    await expect(owner.getByText("What is sent to the AI")).toBeVisible();
    const toggle = owner.getByRole("switch", { name: "Let teachers ask for AI drafts" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await owner.reload();
    await expect(owner.getByRole("switch", { name: "Let teachers ask for AI drafts" })).toHaveAttribute("aria-checked", "true", {
      timeout: 60_000,
    });
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: admin.schoolId },
      select: { assignmentFeedbackAiEnabled: true },
    });
    expect(school.assignmentFeedbackAiEnabled).toBe(true);
    // The platform's switch for this school stays off (its default).
    await basePrisma.school.update({ where: { id: admin.schoolId }, data: { aiEnabled: false } });

    // 2. A teacher collects work and marks by hand; nothing about AI appears.
    const page = teacher.page;
    await page.goto("/teacher/homework");
    await expect(page.getByRole("heading", { name: "Set homework" })).toBeVisible({ timeout: 60_000 });
    const pickers = page.getByRole("combobox");
    await pickers.nth(0).selectOption({ label: "JSS 2 Gold" });
    await pickers.nth(1).selectOption({ index: 1 });
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Due").fill(addDaysIso(lagosTodayIso(), 2));
    await page.getByRole("button", { name: "Set homework" }).click();
    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.getByRole("button", { name: "Collect work" }).click();
    await item.getByLabel("Total marks").fill("10");
    await item.getByRole("button", { name: "Start collecting" }).click();
    await expect(item.getByRole("link", { name: "Handed-in work" })).toBeVisible({ timeout: 30_000 });
    await withTenant(admin.schoolId, async (db) => {
      const hw = await db.assignment.findFirstOrThrow({ where: { title }, include: { collection: true } });
      await db.assignmentSubmission.create({
        data: {
          schoolId: admin.schoolId,
          collectionId: hw.collection!.id,
          studentId: guardian.studentId,
          attempt: 1,
          body: `Plants make sugar from light ${suffix}`,
          typedChars: 30,
        },
      });
    });

    await item.getByRole("link", { name: "Handed-in work" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Chidinma Adeleke/ }).click();
    const form = page.getByRole("form", { name: "Mark attempt 1" });
    await expect(form).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Draft with AI|AI drafts|Draft feedback for all/)).toHaveCount(0);
    await form.getByLabel("Mark out of 10").fill("7");
    await form.getByLabel("Feedback").fill("Good start.");
    await form.getByRole("button", { name: "Save mark" }).click();
    await expect(page.getByText("Marked 7/10")).toBeVisible({ timeout: 30_000 });
    const saved = await withTenant(admin.schoolId, (db) =>
      db.assignmentSubmission.findFirstOrThrow({ where: { studentId: guardian.studentId }, select: { mark: true, feedbackAiDrafted: true } }),
    );
    expect(saved).toEqual({ mark: 7, feedbackAiDrafted: false });
  } finally {
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
