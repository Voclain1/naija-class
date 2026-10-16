import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { apiCreateEnrollment, setupFinanceScaffold } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP5.1 — student charges and supplementary invoices
// (docs/modules/phase-9.md §13), in a real browser against a throwaway school.
//
// A charge added before the term invoice rides on it; one added after is
// billed on a supplementary invoice by "Bill waiting charges"; an open charge
// can be voided with a reason; and the parent sees the supplementary invoice.

test("charges ride on the term invoice, later ones go on a supplementary invoice the parent sees", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Gold", code: `jss1g-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const arm = structure.arms[0]!;
  await setupFinanceScaffold(admin.api, {
    suffix,
    termId: structure.termId,
    classArmId: arm.id,
    classLevelId: structure.classLevelId,
    academicYearId: structure.academicYearId,
  });
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  await apiCreateEnrollment(admin.api, { studentId: guardian.studentId, termId: structure.termId, classArmId: arm.id });
  const child = `${guardian.studentFirstName} ${guardian.lastName}`;
  const parentContext = await browser.newContext();

  try {
    const page = admin.page;
    await page.goto("/finance/charges");
    await expect(page.getByRole("heading", { name: "Charges" })).toBeVisible();
    await expect(page.locator("#charges-year")).not.toHaveValue("");
    // The term is never chosen for the bursar.
    await expect(page.locator("#charges-term")).toHaveValue("");
    await page.locator("#charges-term").selectOption({ index: 1 });
    await page.locator("#charges-class").selectOption({ label: arm.name });

    // 1. A charge before the term invoice: it waits, then rides on it.
    await page.getByRole("button", { name: `Add a charge for ${child}` }).click();
    const form = page.getByRole("form", { name: `New charge for ${child}` });
    await form.getByLabel("What it is for").fill("Excursion to Badagry");
    await form.getByLabel("Amount (₦)").fill("5,000");
    await form.getByRole("button", { name: "Add charge" }).click();
    await expect(page.getByText("Excursion to Badagry")).toBeVisible();
    await expect(page.getByText("Waiting to be billed")).toBeVisible();
    await expect(page.getByText(/1 student has charges that will go on their term invoice/)).toBeVisible();

    const generated = await admin.api.post("invoices/arm/generate", {
      data: { termId: structure.termId, classArmId: arm.id },
    });
    expect(generated.ok()).toBe(true);
    await page.reload();
    await page.locator("#charges-term").selectOption({ index: 1 });
    await page.locator("#charges-class").selectOption({ label: arm.name });
    await expect(page.getByText("On the term invoice")).toBeVisible();

    // 2. A charge after the term invoice goes on a supplementary invoice.
    await page.getByRole("button", { name: `Add a charge for ${child}` }).click();
    await form.getByLabel("What it is for").fill("Sports kit");
    await form.getByLabel("Amount (₦)").fill("2500");
    await form.getByRole("button", { name: "Add charge" }).click();
    await expect(page.getByText("Sports kit")).toBeVisible();
    await expect(page.getByText(/1 student has charges waiting, ₦2,500(\.00)? in all/)).toBeVisible();
    await page.getByRole("button", { name: "Bill waiting charges" }).click();
    await expect(page.getByText(/1 supplementary invoice issued for ₦2,500/)).toBeVisible();
    await expect(page.getByText("On a supplementary invoice")).toBeVisible();

    // 3. An open charge is voided with a reason.
    await page.getByRole("button", { name: `Add a charge for ${child}` }).click();
    await form.getByLabel("What it is for").fill("Lab coat");
    await form.getByLabel("Amount (₦)").fill("1,200");
    await form.getByRole("button", { name: "Add charge" }).click();
    await page.getByRole("button", { name: "Void Lab coat" }).click();
    await page.getByLabel("Why is it being voided?").fill("Already has one");
    await page.getByRole("button", { name: "Void charge" }).click();
    await expect(page.getByText("Voided")).toBeVisible();
    await expect(page.getByText("Reason: Already has one")).toBeVisible();
    await expect(page.getByLabel("Why is it being voided?")).toHaveCount(0);

    // 4. The bursar's invoice page names it.
    await page.getByRole("link", { name: "View invoice" }).last().click();
    await expect(page.getByRole("heading", { name: "Supplementary invoice" })).toBeVisible();
    await expect(page.getByText("Sports kit")).toBeVisible();

    // 5. The parent sees it beside the term invoice.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByText("Supplementary invoice")).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText(/Sports kit/)).toBeVisible();
    await expect(parent.getByText(/Excursion to Badagry/)).toBeVisible();
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
