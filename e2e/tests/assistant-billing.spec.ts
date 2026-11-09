import { expect, test, type Browser } from "@playwright/test";
import { basePrisma } from "@school-kit/db";
import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { setupFinanceScaffold } from "../fixtures/finance.js";

async function scaffold(browser: Browser, enabled = true) {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 2 A", code: `bill-${suffix}`.slice(0, 20) }], subjectCode: `bill-${suffix}`.slice(0, 20) });
  await setupFinanceScaffold(admin.api, { suffix, ...structure, classArmId: structure.arms[0]!.id });
  if (enabled) await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: { "assistant-billing": true } } });
  await admin.page.goto("/finance/invoices");
  return { admin, structure, page: admin.page };
}

test("billing workbench prepares, requires explicit approval, executes and restores the durable result", async ({ browser }) => {
  const { admin, structure, page } = await scaffold(browser);
  try {
    await page.getByRole("button", { name: "Prepare a billing run" }).click();
    await page.getByLabel("Billing term").selectOption(structure.termId);
    await page.getByText("Choose classes directly", { exact: true }).click();
    await page.getByRole("checkbox", { name: "JSS 2 · JSS 2 A", exact: true }).check();
    await page.getByRole("button", { name: "Preview selected classes" }).click();
    await expect(page.getByRole("heading", { name: /Review before issuing/ })).toBeVisible();
    const approve = page.getByRole("button", { name: "Approve and issue invoices" });
    await expect(approve).toBeDisabled();
    const before = await admin.api.get(`invoices?termId=${structure.termId}`);
    expect((await before.json()).total).toBe(0);
    await page.getByRole("checkbox", { name: /I have checked the term/ }).check();
    await approve.click();
    await expect(page.getByRole("heading", { name: /Billing complete/ })).toBeVisible();
    const after = await admin.api.get(`invoices?termId=${structure.termId}`);
    expect((await after.json()).total).toBe(3);
    await page.reload();
    await page.getByRole("button", { name: "Prepare a billing run" }).click();
    await page.getByText("Recent billing runs", { exact: true }).click();
    await page.getByRole("button", { name: /Completed$/ }).click();
    await expect(page.getByRole("heading", { name: /Billing complete/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve and issue invoices" })).toHaveCount(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("a changed invoice preview is refused, with no second issuance", async ({ browser }) => {
  const { admin, structure, page } = await scaffold(browser);
  try {
    await page.getByRole("button", { name: "Prepare a billing run" }).click();
    await page.getByLabel("Billing term").selectOption(structure.termId);
    await page.getByText("Choose classes directly", { exact: true }).click();
    await page.getByRole("checkbox", { name: "JSS 2 · JSS 2 A", exact: true }).check();
    await page.getByRole("button", { name: "Preview selected classes" }).click();
    await expect(page.getByRole("heading", { name: /Review before issuing/ })).toBeVisible();
    const manual = await admin.api.post("invoices/arm/generate", { data: { termId: structure.termId, classArmId: structure.arms[0]!.id } });
    expect(manual.ok()).toBe(true);
    await page.getByRole("checkbox", { name: /I have checked the term/ }).check();
    await page.getByRole("button", { name: "Approve and issue invoices" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /changed/ })).toBeVisible();
    const after = await admin.api.get(`invoices?termId=${structure.termId}`);
    expect((await after.json()).total).toBe(3);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("the assistant has no entry point while its school switch is off", async ({ browser }) => {
  const { admin, page } = await scaffold(browser, false);
  try {
    await expect(page.locator("#invoice-year")).not.toHaveValue("");
    await expect(page.getByRole("button", { name: "Prepare a billing run" })).toHaveCount(0);
    const context = await admin.api.get("assistant/billing/context");
    expect(context.status()).toBe(403);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});
