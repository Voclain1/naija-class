import { expect, test, type BrowserContext } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { armId, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Release changes family visibility. This UI regression keeps the actual release
// request intercepted: the card is a disposable local-test record, and the test
// proves the client cannot send the mutation until the distinct confirmation is
// deliberately chosen.
test("report-card release requires confirmation and cannot be sent by dismissing", async ({ browser }) => {
  const toClose: BrowserContext[] = [];
  const admin = await loginAsAdmin(browser);
  toClose.push(admin.context);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Blue", code: `jss2-blue-${suffix}` }],
    subjectCode: `rc-${suffix}`,
  });
  const classArmId = armId(structure, "JSS 2 Blue");
  let studentId = "";

  let releaseRequests = 0;
  let allowResponse: (() => void) | undefined;
  const releaseResponse = new Promise<void>((resolve) => {
    allowResponse = resolve;
  });

  try {
    studentId = await withTenant(admin.schoolId, async (db) => {
      const student = await db.student.create({
        data: {
          schoolId: admin.schoolId,
          admissionNumber: `RC-${suffix}`,
          firstName: "Ada",
          lastName: "Release",
          dateOfBirth: new Date("2012-09-15"),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      await db.reportCard.create({
        data: {
          schoolId: admin.schoolId,
          studentId: student.id,
          termId: structure.termId,
          academicYearId: structure.academicYearId,
          classArmId,
          status: "PRINCIPAL_APPROVED",
          principalApprovedAt: new Date(),
          principalApprovedBy: admin.ownerUserId,
          overallTotal: 84,
          overallAverage: 8400,
          subjectsCount: 1,
        },
      });
      return student.id;
    });

    await admin.page.route("**/report-cards/arm/release", async (route) => {
      releaseRequests += 1;
      await releaseResponse;
      await withTenant(admin.schoolId, (db) =>
        db.reportCard.updateMany({
          where: { termId: structure.termId, classArmId },
          data: { status: "RELEASED", releasedAt: new Date() },
        }),
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "RELEASED", cardCount: 1 }),
      });
    });

    await admin.page.goto(`/report-cards/${classArmId}?termId=${structure.termId}`);
    await expect(admin.page.getByRole("button", { name: "Release arm" })).toBeVisible();

    await admin.page.getByRole("button", { name: "Release arm" }).click();
    const dialog = admin.page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Release report cards" })).toBeVisible();
    await expect(dialog.getByText("JSS 2 Blue")).toBeVisible();
    await expect(dialog.getByText("First Term")).toBeVisible();
    await expect(dialog.getByText("1 report card", { exact: true })).toBeVisible();

    await dialog.getByRole("button", { name: "Keep reviewing" }).click();
    await expect(dialog).toHaveCount(0);
    expect(releaseRequests).toBe(0);

    await admin.page.getByRole("button", { name: "Release arm" }).click();
    const confirm = admin.page.getByRole("button", { name: "Release 1 report card" });
    await confirm.click();
    await expect(admin.page.getByRole("button", { name: "Releasing\u2026" })).toBeDisabled();
    await expect.poll(() => releaseRequests).toBe(1);

    // The button is disabled while the request is held, so a double click
    // cannot enqueue a second release mutation.
    await expect(admin.page.getByRole("button", { name: "Keep reviewing" })).toBeDisabled();
    allowResponse?.();
    await expect(admin.page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await admin.page.unroute("**/report-cards/arm/release");
    if (studentId) {
      await withTenant(admin.schoolId, async (db) => {
        await db.reportCard.deleteMany({ where: { studentId } });
        await db.student.delete({ where: { id: studentId } });
      });
    }
    for (const context of toClose) await context.close();
    await admin.api.dispose();
  }
});
