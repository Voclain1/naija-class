import { expect, test } from "@playwright/test";
import { withTenant } from "@school-kit/db";
import { addDaysIso, lagosTodayIso } from "@school-kit/types";

import { armId, assignTeacher, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP4.1 — collected work, marked and released (docs/modules/phase-9.md
// §11). Through the real UI: a teacher sets homework and switches on "collect
// work"; the child's typed answer arrives (seeded directly — students hand in
// from the app, and the API path is covered by assignments.service.spec.ts);
// the teacher marks it and releases; the parent then sees the mark and the
// feedback on the parent website, and never the answer or the paste figure.
test("a teacher collects work, marks it and releases; the parent sees the mark", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const title = `Photosynthesis ${suffix}`;
  const answer = `Plants make sugar from light ${suffix}`;
  const feedback = `Good start ${suffix}`;
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 2 Gold", code: `j2g-${suffix}` }] });
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
  const parentContext = await browser.newContext();
  try {
    // 1. The teacher sets homework and switches on "collect work".
    const page = teacher.page;
    await page.goto("/teacher/homework");
    await expect(page.getByRole("heading", { name: "Set homework" })).toBeVisible({ timeout: 60_000 });
    // By position: the subject box's placeholder ("Choose a class first") also
    // matches a label search for "Class".
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

    // 2. The child's answer arrives, as the app would hand it in.
    await withTenant(admin.schoolId, async (db) => {
      const hw = await db.assignment.findFirstOrThrow({ where: { title }, include: { collection: true } });
      await db.assignmentSubmission.create({
        data: {
          schoolId: admin.schoolId,
          collectionId: hw.collection!.id,
          studentId: guardian.studentId,
          attempt: 1,
          body: answer,
          typedChars: 10,
          pastedChars: answer.length - 10,
        },
      });
    });

    // 3. The teacher marks it and releases.
    await item.getByRole("link", { name: "Handed-in work" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Chidinma Adeleke/ }).click();
    await expect(page.getByText(answer)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/% of this answer was pasted/)).toBeVisible();
    const form = page.getByRole("form", { name: "Mark attempt 1" });
    await form.getByLabel("Mark out of 10").fill("8");
    await form.getByLabel("Feedback").fill(feedback);
    await form.getByRole("button", { name: "Save mark" }).click();
    await expect(page.getByText("Marked 8/10")).toBeVisible({ timeout: 30_000 });
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Release 1 mark" }).click();
    await expect(page.getByRole("button", { name: "No new marks to release" })).toBeVisible({ timeout: 30_000 });

    // 4. The parent sees the mark and the feedback, never the answer.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByRole("heading", { name: "Homework" })).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText(title)).toBeVisible();
    await expect(parent.getByText("Marked · 8/10")).toBeVisible();
    await expect(parent.getByText(feedback)).toBeVisible();
    await expect(parent.getByText(answer)).toHaveCount(0);
    await expect(parent.getByText(/pasted/)).toHaveCount(0);
  } finally {
    await parentContext.close();
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
