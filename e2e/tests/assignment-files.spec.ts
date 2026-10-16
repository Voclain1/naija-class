import { expect, test } from "@playwright/test";
import { withTenant } from "@school-kit/db";
import { addDaysIso, lagosTodayIso } from "@school-kit/types";

import { armId, assignTeacher, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP4.2 — file answers (docs/modules/phase-9.md §11, Q8). A child's
// handed-in PDF (seeded: students attach files from the app, and the upload,
// the type check and the three-file limit are covered by
// assignments.service.spec.ts) is opened by the class's teacher and by the
// child's parent, each through a short-lived link. A file the child has only
// staged is not on the parent's page at all.
test("the teacher and the parent open a handed-in PDF; a staged file stays hidden", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const title = `Draw a leaf ${suffix}`;
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 1 Blue", code: `j1b-${suffix}` }] });
  const classArmId = armId(structure, "JSS 1 Blue");
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

  const homeworkId = await withTenant(admin.schoolId, async (db) => {
    const hw = await db.assignment.create({
      data: {
        schoolId: admin.schoolId,
        classArmId,
        subjectId: structure.subjectId,
        createdBy: invited.userId,
        title,
        dueDate: new Date(`${addDaysIso(lagosTodayIso(), 2)}T00:00:00.000Z`),
      },
    });
    const collection = await db.assignmentCollection.create({
      data: { schoolId: admin.schoolId, assignmentId: hw.id, totalMarks: 10, createdBy: invited.userId },
    });
    const submission = await db.assignmentSubmission.create({
      data: { schoolId: admin.schoolId, collectionId: collection.id, studentId: guardian.studentId, attempt: 1 },
    });
    await db.assignmentSubmissionFile.create({
      data: { schoolId: admin.schoolId, collectionId: collection.id, studentId: guardian.studentId, submissionId: submission.id, ext: "pdf", size: 1200 },
    });
    return hw.id;
  });

  const teacher = await loginAsTeacher(browser, invited.email, invited.password);
  const parentContext = await browser.newContext();
  try {
    // 1. The teacher opens it from the marking page.
    const page = teacher.page;
    await page.goto(`/teacher/homework/${homeworkId}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Chidinma Adeleke/ }).click();
    const [teacherLink] = await Promise.all([
      page.waitForResponse((r) => /\/assignments\/files\/[0-9a-f-]+$/.test(new URL(r.url()).pathname)),
      page.getByRole("button", { name: /View PDF/ }).click(),
    ]);
    expect(teacherLink.status()).toBe(200);

    // 2. The child stages a second file but does not hand it in.
    await withTenant(admin.schoolId, async (db) => {
      const collection = await db.assignmentCollection.findUniqueOrThrow({ where: { assignmentId: homeworkId } });
      await db.assignmentSubmissionFile.create({
        data: { schoolId: admin.schoolId, collectionId: collection.id, studentId: guardian.studentId, ext: "jpg", size: 900 },
      });
    });

    // 3. The parent sees the handed-in PDF only, and opens it.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByText(title)).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByRole("button", { name: /View photo/ })).toHaveCount(0);
    const [parentLink] = await Promise.all([
      parent.waitForResponse((r) => /\/assignment-files\/[0-9a-f-]+$/.test(new URL(r.url()).pathname)),
      parent.getByRole("button", { name: "View PDF" }).click(),
    ]);
    expect(parentLink.status()).toBe(200);
  } finally {
    await parentContext.close();
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
