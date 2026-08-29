import { expect, test, type Page } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { armId, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian, PORTAL_BASE_URL, type PortalGuardian } from "../fixtures/guardian.js";

async function signIn(page: Page, guardian: PortalGuardian): Promise<void> {
  await page.goto(`${PORTAL_BASE_URL}/login`);
  await page.getByLabel("Email").fill(guardian.email);
  await page.getByLabel("Password", { exact: true }).fill(guardian.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
}

test("guardian portal lists only released results with clear child context", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const noResultsGuardian = await createPortalGuardian(admin.api, {
    suffix: `${suffix}-empty`,
    schoolId: admin.schoolId,
  });
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Blue", code: `jss2-blue-${suffix}` }],
    subjectCode: `gr-${suffix}`,
  });
  const classArmId = armId(structure, "JSS 2 Blue");

  await withTenant(admin.schoolId, async (db) => {
    const secondTerm = await db.term.create({
      data: {
        schoolId: admin.schoolId,
        academicYearId: structure.academicYearId,
        sequence: 2,
        name: "Second Term",
        startDate: new Date("2026-01-05"),
        endDate: new Date("2026-04-10"),
      },
    });
    await db.reportCard.createMany({
      data: [
        {
          schoolId: admin.schoolId,
          studentId: guardian.studentId,
          termId: structure.termId,
          academicYearId: structure.academicYearId,
          classArmId,
          status: "RELEASED",
          releasedAt: new Date(),
          overallTotal: 84,
          overallAverage: 8400,
          subjectsCount: 1,
        },
        {
          schoolId: admin.schoolId,
          studentId: guardian.studentId,
          termId: secondTerm.id,
          academicYearId: structure.academicYearId,
          classArmId,
          status: "PRINCIPAL_APPROVED",
          principalApprovedAt: new Date(),
          principalApprovedBy: admin.ownerUserId,
          overallTotal: 90,
          overallAverage: 9000,
          subjectsCount: 1,
        },
      ],
    });
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  const emptyContext = await browser.newContext();
  const emptyPage = await emptyContext.newPage();

  try {
    await signIn(page, guardian);
    await page.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await page.getByRole("link", { name: "View released results" }).click();

    await expect(page.getByRole("heading", { name: "Released results" })).toBeVisible();
    await expect(page.getByText("Chidinma Adeleke")).toBeVisible();
    await expect(page.getByText("First Term")).toBeVisible();
    await expect(page.getByText("Second Term")).toHaveCount(0);
    await expect(page.getByText("84.00%")).toBeVisible();

    await signIn(emptyPage, noResultsGuardian);
    await emptyPage.goto(`${PORTAL_BASE_URL}/students/${noResultsGuardian.studentId}/results`);
    await expect(emptyPage.getByRole("heading", { name: "Nothing released yet" })).toBeVisible();
    await expect(emptyPage.getByText(/When the school publishes a term/i)).toBeVisible();

    await emptyPage.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}/results`);
    await expect(emptyPage.locator("main").getByRole("alert")).toContainText(
      "couldn't load results",
    );
    await expect(emptyPage.getByText("Chidinma Adeleke")).toHaveCount(0);
  } finally {
    await context.close();
    await emptyContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
