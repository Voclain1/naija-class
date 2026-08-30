import { expect, test, type Page } from "@playwright/test";

import { createPortalGuardian, PORTAL_BASE_URL, type PortalGuardian } from "../fixtures/guardian.js";
import { armId, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";

async function signInGuardian(page: Page, guardian: PortalGuardian): Promise<void> {
  await page.goto(`${PORTAL_BASE_URL}/login`);
  await page.getByLabel("Email").fill(guardian.email);
  await page.getByLabel("Password", { exact: true }).fill(guardian.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
}

test("enrollment shows a human identity and title-cased status, never a student UUID", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Gold", code: `jss1-gold-${suffix}` }],
    subjectCode: `term-${suffix}`,
  });
  const student = await apiCreateStudent(admin.api, {
    admissionNumber: `ADM/${suffix}/001`,
    firstName: "Amina",
    lastName: "Bello-Okafor",
    dateOfBirth: "2013-01-04T00:00:00.000Z",
    gender: "FEMALE",
  });
  await apiCreateEnrollment(admin.api, {
    studentId: student.id,
    termId: structure.termId,
    classArmId: armId(structure, "JSS 1 Gold"),
  });

  try {
    await admin.page.goto("/enrollments");
    await expect(admin.page.getByText("Bello-Okafor, Amina")).toBeVisible();
    await expect(admin.page.getByText(`ADM/${suffix}/001`)).toBeVisible();
    await expect(admin.page.getByText("Enrolled", { exact: true })).toBeVisible();
    const pageText = (await admin.page.locator("main").textContent()) ?? "";
    expect(pageText).not.toContain(student.id);
    expect(pageText).not.toContain(student.id.slice(0, 8));
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});

test("dashboard errors give recovery guidance instead of raw exception text", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Gold", code: `jss2-gold-${uniqueSuffix()}` }],
    subjectCode: `dash-${uniqueSuffix()}`,
  });

  try {
    await admin.page.route("**/api/v1/dashboard?**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "DATABASE_TIMEOUT", message: "DATABASE_TIMEOUT: 5xx" } }),
      });
    });
    await admin.page.goto(`/dashboard?termId=${structure.termId}`);
    await expect(admin.page.getByText("We couldn’t load your dashboard. Refresh and try again.")).toBeVisible();
    await expect(admin.page.getByText("DATABASE_TIMEOUT", { exact: false })).toHaveCount(0);
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});

test("guardian access fallback and portal branding do not expose technical status text", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const guardian = await createPortalGuardian(admin.api, {
    suffix: uniqueSuffix(),
    schoolId: admin.schoolId,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await signInGuardian(page, guardian);
    await page.route("**/api/portal/students/*/portal-status", async (route) => {
      await route.fulfill({ status: 503, contentType: "text/plain", body: "upstream unavailable" });
    });
    await page.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(page.getByRole("heading", { name: "SchoolKit account" })).toBeVisible();
    await expect(page.getByText("Could not load account status. Try again.")).toBeVisible();
    await expect(page.getByText(/error 503/i)).toHaveCount(0);

    await page.goto(`${PORTAL_BASE_URL}/login`);
    await expect(page.getByRole("heading", { name: "SchoolKit" })).toBeVisible();
  } finally {
    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
