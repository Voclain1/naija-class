import { expect, test } from "@playwright/test";

import { setupAcademicStructure } from "../fixtures/academic.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP3.2 — vaccinations with a document (docs/modules/phase-9.md
// §10, F1). Through the real UI: the Health officer records a vaccination and
// attaches a PDF of the card; the parent sees it in the portal and opens the
// document through its short-lived link.
test("the health officer attaches a vaccination card; the parent opens it", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const vaccine = `Yellow fever ${suffix}`;
  const admin = await loginAsAdmin(browser);
  await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 2 Blue", code: `jss2-blue-${suffix}` }] });
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const invited = await inviteAndAcceptTeacher(browser, {
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
    firstName: "Halima",
    lastName: "Officer",
    roleKey: "health_officer",
  });
  await invited.context.close();
  const officer = await loginAsTeacher(browser, invited.email, invited.password);
  const parentContext = await browser.newContext();

  try {
    // 1. Record the vaccination and attach a PDF.
    const page = officer.page;
    await page.goto(`/health/students/${guardian.studentId}`);
    await expect(page.getByRole("heading", { name: "Vaccinations" })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Vaccine").fill(vaccine);
    await page.getByLabel("Date given").fill("2026-03-14");
    await page.getByRole("button", { name: "Add vaccination" }).click();
    const row = page.getByRole("listitem").filter({ hasText: vaccine });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Anything that is not an image or a PDF is refused, whatever its name.
    await row.getByLabel(`Document for ${vaccine}`).setInputFiles({
      name: "card.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("this is not really a pdf"),
    });
    await expect(row.getByText(/photo .*or a PDF/)).toBeVisible({ timeout: 30_000 });

    await row.getByLabel(`Document for ${vaccine}`).setInputFiles({
      name: "card.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"),
    });
    await expect(row.getByRole("button", { name: "View PDF" })).toBeVisible({ timeout: 30_000 });

    // 2. The parent sees it and opens the document.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByText(vaccine)).toBeVisible({ timeout: 60_000 });
    // The portal asks for a short-lived link and opens it in a new tab. (In
    // local development a PDF link downloads rather than displays, so the
    // check is on the link the API handed back, not on the tab's address.)
    const [linkResponse] = await Promise.all([
      parent.waitForResponse((r) => /\/vaccinations\/[0-9a-f-]+\/document$/.test(new URL(r.url()).pathname)),
      parentContext.waitForEvent("page"),
      parent.getByRole("button", { name: "View PDF" }).click(),
    ]);
    expect(linkResponse.status()).toBe(200);
    expect(((await linkResponse.json()) as { url: string }).url).toMatch(/health\/[0-9a-f-]+\.pdf/);
  } finally {
    await parentContext.close();
    await officer.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
