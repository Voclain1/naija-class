import { expect, test, type Page } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian, PORTAL_BASE_URL, type PortalGuardian } from "../fixtures/guardian.js";

// Guardian portal — the school's bank transfer details beside unpaid invoices.
// Plan-first: docs/modules/school-bank-details.md §11.
//
// Setup goes through the REAL admin path (PATCH /schools/me, the audited,
// owner/admin-gated endpoint) rather than writing the columns directly, so the
// toggle the test flips is the toggle an admin flips.

const ACCOUNT_NUMBER = "0123456789";
const SHOTS = "test-results/portal-bank-details";

async function signIn(page: Page, guardian: PortalGuardian): Promise<void> {
  await page.goto(`${PORTAL_BASE_URL}/login`);
  await page.getByLabel("Email").fill(guardian.email);
  await page.getByLabel("Password", { exact: true }).fill(guardian.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
}

test("guardian sees the school's transfer details beside an unpaid invoice, and only then", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const owing = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const paidUp = await createPortalGuardian(admin.api, { suffix: `${suffix}-paid`, schoolId: admin.schoolId });
  const structure = await setupAcademicStructure(admin.api, { subjectCode: `pbd-${suffix}` });

  const invoiceBase = {
    schoolId: admin.schoolId,
    termId: structure.termId,
    academicYearId: structure.academicYearId,
    items: [
      { feeItemId: "fi-1", categoryName: "Tuition", feeName: "First Term Tuition", amount: 150_000_00, discountsApplied: [], netAmount: 150_000_00 },
    ],
    totalAmount: 150_000_00,
    totalDiscount: 0,
    totalDue: 150_000_00,
    issuedAt: new Date(),
  };
  await withTenant(admin.schoolId, async (db) => {
    await db.invoice.create({ data: { ...invoiceBase, studentId: owing.studentId, status: "ISSUED", totalPaid: 0 } });
    await db.invoice.create({ data: { ...invoiceBase, studentId: paidUp.studentId, status: "PAID", totalPaid: 150_000_00 } });
  });

  const enable = async (enabled: boolean) => {
    const res = await admin.api.patch("schools/me", {
      data: {
        bankName: "Zenith Bank",
        bankAccountName: "Bright Future Academy",
        bankAccountNumber: ACCOUNT_NUMBER,
        bankDetailsEnabled: enabled,
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
  };

  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const paidContext = await browser.newContext();
  const paidPage = await paidContext.newPage();

  try {
    await enable(true);

    // 1. Enabled, invoice unpaid → the block is there with every field.
    await signIn(page, owing);
    await page.goto(`${PORTAL_BASE_URL}/students/${owing.studentId}`);
    const block = page.getByRole("region", { name: "Prefer to pay by bank transfer?" });
    await expect(block).toBeVisible();
    await expect(block).toContainText("Zenith Bank");
    await expect(block).toContainText("Bright Future Academy");
    await expect(block).toContainText(ACCOUNT_NUMBER);
    await expect(block).toContainText(`SKA/G/${suffix}`);
    await expect(block).toContainText("the invoice updates once the school has recorded it");
    await page.screenshot({ path: `${SHOTS}/1-enabled-unpaid.png`, fullPage: true });
    await block.screenshot({ path: `${SHOTS}/1b-block-desktop.png` });

    await block.getByRole("button", { name: "Copy" }).click();
    await expect(block.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ACCOUNT_NUMBER);

    // Parents are overwhelmingly on phones.
    await page.setViewportSize({ width: 390, height: 844 });
    await block.scrollIntoViewIfNeeded();
    await block.screenshot({ path: `${SHOTS}/1c-block-phone.png` });
    await page.setViewportSize({ width: 1280, height: 720 });

    // 2. Admin switches it off → gone on reload, digits nowhere in the page,
    //    invoices untouched.
    await enable(false);
    await page.reload();
    await expect(page.getByText("First Term Tuition")).toBeVisible();
    await expect(page.getByRole("region", { name: "Prefer to pay by bank transfer?" })).toHaveCount(0);
    expect(await page.content()).not.toContain(ACCOUNT_NUMBER);
    await page.screenshot({ path: `${SHOTS}/2-disabled.png`, fullPage: true });

    // 3. Enabled again, but this child owes nothing → no block.
    await enable(true);
    await signIn(paidPage, paidUp);
    await paidPage.goto(`${PORTAL_BASE_URL}/students/${paidUp.studentId}`);
    await expect(paidPage.getByText("First Term Tuition")).toBeVisible();
    await expect(paidPage.getByRole("region", { name: "Prefer to pay by bank transfer?" })).toHaveCount(0);
    await paidPage.screenshot({ path: `${SHOTS}/3-enabled-all-paid.png`, fullPage: true });

    // 4. The admin copy now says what is true.
    await admin.page.goto("/settings/finance/payments");
    // exact: the Paystack section on the same page has its own "What parents
    // see on the Paystack checkout page…" line.
    const previewHeading = admin.page.getByText("What parents see", { exact: true });
    await expect(previewHeading).toBeVisible();
    await expect(admin.page.getByRole("checkbox", { name: /^Show these details to parents/ })).toBeVisible();
    // The Paystack form renders BELOW this card; the copy said "above" (#288).
    await expect(admin.page.getByText("This is separate from the Paystack details below")).toBeVisible();
    await previewHeading.scrollIntoViewIfNeeded();
    await admin.page.screenshot({ path: `${SHOTS}/4-admin-settings.png`, fullPage: true });
  } finally {
    await context.close();
    await paidContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
