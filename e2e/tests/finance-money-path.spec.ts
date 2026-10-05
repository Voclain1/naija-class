import { expect, test, type Page } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { apiListInvoices, setupFinanceScaffold } from "../fixtures/finance.js";
import {
  inviteAndAcceptTeacher,
  loginAsAdmin,
  setupAcademicStructure,
  uniqueSuffix,
  type AdminSession,
} from "../fixtures/index.js";

// The money path through the real screens (docs/deferred.md item 3). The
// invoice journey and bulk-generation specs cover issuing and cancelling;
// these cover what happens to money AFTER an invoice exists:
//
//   1. A payment recorded on an invoice moves the invoice's own figures, then
//      the term's figures on the finance dashboard: collected, outstanding and
//      the collection rate.
//   2. An expense logged through the form lands in the list and in the term's
//      total expenses.
//   3. Payroll: run, approve, payslip. Net pay is the server's figure.
//
// Setup is over HTTP; every money figure asserted on screen is one the API
// computed (CLAUDE.md "Money": the frontend displays, never computes). Each
// test provisions its own school on the LOCAL Postgres.

const FEE_KOBO = 45_000_00; // per student; the scaffold enrols three

async function invoicedSchool(browser: Parameters<typeof loginAsAdmin>[0]) {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 A", code: `mp-${suffix}`.slice(0, 20) }],
    subjectCode: `mpm-${suffix}`.slice(0, 20),
  });
  await setupFinanceScaffold(admin.api, {
    suffix,
    termId: structure.termId,
    classArmId: structure.arms[0]!.id,
    classLevelId: structure.classLevelId,
    academicYearId: structure.academicYearId,
    feeAmountKobo: FEE_KOBO,
  });
  const generated = await admin.api.post("invoices/arm/generate", {
    data: { termId: structure.termId, classArmId: structure.arms[0]!.id },
  });
  expect(generated.ok(), await generated.text()).toBe(true);
  return { admin, termId: structure.termId };
}

/** Opens the finance dashboard and waits for the term's figures, not a spinner. */
async function openDashboard(page: Page) {
  await page.goto("/finance/dashboard");
  await expect(page.getByText("Collection rate")).toBeVisible({ timeout: 90_000 });
}

/** A labelled figure: the innermost box holding the label AND a naira amount. */
function figure(page: Page, label: string) {
  return page
    .locator("div", { has: page.getByText(label, { exact: true }) })
    .filter({ hasText: "₦" })
    .last();
}

/** The big percentage beside "Collection rate" (the API's collectionRatePercent). */
function collectionRate(page: Page) {
  return page
    .locator("div", { has: page.getByText("Collection rate", { exact: true }) })
    .filter({ hasText: "%" })
    .last()
    .locator("span.font-serif");
}

async function close(admin: AdminSession) {
  await admin.context.close();
  await admin.api.dispose();
}

test("a recorded payment moves the invoice's balance and the term's collection rate", async ({ browser }) => {
  const { admin, termId } = await invoicedSchool(browser);
  const page = admin.page;
  try {
    const invoices = await apiListInvoices(admin.api, { termId });
    expect(invoices.total).toBe(3);
    const invoiceId = invoices.data[0]!.id as string;

    // ---- Before: three invoices, nothing collected -------------------------
    await openDashboard(page);
    await expect(figure(page, "Total invoiced")).toContainText("₦135,000.00");
    await expect(figure(page, "Total collected")).toContainText("₦0.00");
    await expect(collectionRate(page)).toHaveText("0%");

    // ---- Record ₦20,000 by bank transfer on one invoice ---------------------
    await page.goto(`/finance/invoices/${invoiceId}`);
    await expect(page.getByRole("heading", { name: "Record payment" })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Amount (₦)").last().fill("20000");
    await page.getByLabel("Method").selectOption("BANK_TRANSFER");
    await page.getByLabel("Reference (optional)").fill("GTB-TRF-0042");
    await page.getByRole("button", { name: "Record payment" }).click();

    await expect(page.getByText("Payment recorded.")).toBeVisible();
    // Paid and Balance are the API's totalPaid and totalDue − totalPaid.
    await expect(figure(page, "Paid")).toContainText("₦20,000.00");
    await expect(figure(page, "Balance")).toContainText("₦25,000.00");
    await expect(page.getByRole("cell", { name: "₦20,000.00" })).toBeVisible();

    // One payment row, in kobo, and its audit row (CLAUDE.md: every
    // payment-mutating action writes to audit_logs).
    const { payments, audits } = await withTenant(admin.schoolId, async (db) => ({
      payments: await db.payment.findMany({ where: { invoiceId } }),
      audits: await db.auditLog.count({ where: { action: "payment.record", userId: admin.ownerUserId } }),
    }));
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amount: 20_000_00, method: "BANK_TRANSFER", reference: "GTB-TRF-0042" });
    expect(audits).toBe(1);

    // ---- After: the term's figures moved ------------------------------------
    await openDashboard(page);
    await expect(figure(page, "Total collected")).toContainText("₦20,000.00");
    await expect(figure(page, "Outstanding balance")).toContainText("₦115,000.00");
    // 20,000 / 135,000 = 14.8% → the API rounds to a whole percent.
    await expect(collectionRate(page)).toHaveText("15%");
    await page.screenshot({ path: "test-results/finance-money-path/dashboard-after-payment.png", fullPage: true });
  } finally {
    await close(admin);
  }
});

test("an expense logged through the form lands in the list and in the term's total expenses", async ({ browser }) => {
  const { admin } = await invoicedSchool(browser);
  const page = admin.page;
  try {
    const category = await admin.api.post("expense-categories", { data: { name: "Generator fuel" } });
    expect(category.ok(), await category.text()).toBe(true);

    await page.goto("/finance/expenses");
    await expect(page.getByText("No expenses recorded yet.")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "New expense" }).click();
    const dialog = page.getByRole("dialog", { name: "New expense" });
    await dialog.getByLabel("Category").selectOption({ label: "Generator fuel" });
    await dialog.getByLabel("Amount (₦ naira)").fill("15000");
    // Inside the scaffold's First Term (2025-09-01 to 2025-12-15), which is
    // the window the dashboard's total expenses covers.
    await dialog.getByLabel("Date incurred").fill("2025-10-15");
    await dialog.getByLabel("Description (optional)").fill("Diesel, October");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Expense recorded.")).toBeVisible();
    const row = page.getByRole("row", { name: /Diesel, October/ });
    await expect(row).toContainText("Generator fuel");
    await expect(row).toContainText("₦15,000.00");

    const saved = await withTenant(admin.schoolId, (db) => db.expense.findMany());
    expect(saved).toHaveLength(1);
    expect(saved[0]!.amount).toBe(15_000_00);

    await openDashboard(page);
    await expect(figure(page, "Total expenses")).toContainText("₦15,000.00");
  } finally {
    await close(admin);
  }
});

test("payroll runs, is approved and produces a payslip, with net pay from the server", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  // The staff picker leaves out whoever is signed in, so pay a colleague.
  const teacher = await inviteAndAcceptTeacher(browser, {
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
    firstName: "Ngozi",
    lastName: "Eze",
  });
  try {
    await page.goto("/finance/payroll");
    await expect(page.getByText("No payroll items for this period yet.")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Run payroll" }).click();
    const dialog = page.getByRole("dialog", { name: "Run payroll" });
    // Period stays at its default, the current month, which is the month the
    // list is showing.
    await dialog.getByLabel("Staff member").selectOption({ label: "Ngozi Eze" });
    await dialog.getByLabel("Gross salary (₦ naira)").fill("300000");
    await dialog.getByRole("button", { name: "Add" }).click();
    await dialog.getByPlaceholder("e.g. PAYE").fill("PAYE");
    await dialog.getByPlaceholder("Amount").fill("20000");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("Payroll item created.")).toBeVisible();
    const row = page.getByRole("row", { name: /Ngozi Eze/ });
    await expect(row).toContainText("₦300,000.00");
    await expect(row).toContainText("₦280,000.00");
    await expect(row).toContainText("Draft");

    await row.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Payroll item approved.")).toBeVisible();
    await expect(row).toContainText("Approved");

    // The payslip opens in a new tab; what matters is that it was stored and
    // carries the server's figures.
    const popup = page.context().waitForEvent("page");
    await row.getByRole("button", { name: "Payslip" }).click();
    await (await popup).close();
    await expect(row.getByRole("button", { name: "Payslip" })).toBeHidden();

    const item = await withTenant(admin.schoolId, (db) =>
      db.payrollItem.findFirstOrThrow({ where: { userId: teacher.userId } }),
    );
    expect(item).toMatchObject({ grossSalary: 300_000_00, netSalary: 280_000_00, status: "APPROVED" });
    expect(item.payslipUrl).toBeTruthy();
    const slip = await admin.api.post(`payroll/${item.id}/payslip`);
    expect(slip.ok(), await slip.text()).toBe(true);
    const { url } = (await slip.json()) as { url: string };
    const html = await (await page.request.get(url)).text();
    expect(html).toContain("280,000.00");
    expect(html).toContain("PAYE");
  } finally {
    await teacher.context.close();
    await close(admin);
  }
});
