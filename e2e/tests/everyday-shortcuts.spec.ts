import { expect, test } from "@playwright/test";

import { setupFinanceScaffold } from "../fixtures/finance.js";
import { loginAsAdmin, setupAcademicStructure, uniqueSuffix, type AdminSession } from "../fixtures/index.js";

// Owner's asks of 2026-10-30, through the real screens:
//   1. Add students opens a chooser with every way to add.
//   2. The staff Role filter lists every staff role, not three.
//   3. Record payment: find the student, pick the bill, Paid in full, done.

async function close(admin: AdminSession) {
  await admin.context.close();
  await admin.api.dispose();
}

test("Add students opens every way to add, and each one goes to its page", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  try {
    await page.goto("/students");
    await page.getByRole("button", { name: "Add students" }).first().click({ timeout: 60_000 });
    const chooser = page.getByRole("dialog", { name: "Add students" });
    for (const name of ["One student", "Several in a grid", "Import a spreadsheet", "Scan a register"]) {
      await expect(chooser.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    }
    await chooser.getByRole("link", { name: /Several in a grid/ }).click();
    await expect(page).toHaveURL(/\/students\/new\/bulk$/);
    await expect(page.getByRole("heading", { name: "Add multiple students" })).toBeVisible();
    // The tips are behind the "?", not on the page.
    await expect(page.getByText("Paste from Excel or Google Sheets")).toHaveCount(0);
    await page.getByRole("button", { name: "Help: Adding several students" }).click();
    await expect(page.getByRole("dialog").getByText("Paste from Excel or Google Sheets")).toBeVisible();
  } finally {
    await close(admin);
  }
});

test("the staff Role filter lists every staff role", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  try {
    // The app's base path is /staff, so the staff roster is /staff/staff.
    await page.goto("/staff/staff");
    const role = page.getByLabel("Role", { exact: true });
    await expect(role).toBeVisible({ timeout: 60_000 });
    const options = await role.locator("option").allTextContents();
    for (const name of [
      "Owner",
      "Administrator",
      "Principal",
      "Head teacher",
      "Teacher",
      "Bursar",
      "Admissions officer",
      "Inbox officer",
      "Health officer",
      "Librarian",
      "House master",
      "Storekeeper",
    ]) {
      expect(options, `Role filter offers ${name}`).toContain(name);
    }
  } finally {
    await close(admin);
  }
});

test("Record payment: search the student, Paid in full, receipt", async ({ browser }) => {
  test.setTimeout(4 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  try {
    const suffix = uniqueSuffix();
    const structure = await setupAcademicStructure(admin.api, {
      arms: [{ name: "JSS 1 A", code: `rp-${suffix}`.slice(0, 20) }],
      subjectCode: `rpm-${suffix}`.slice(0, 20),
    });
    const { students } = await setupFinanceScaffold(admin.api, {
      suffix,
      termId: structure.termId,
      classArmId: structure.arms[0]!.id,
      classLevelId: structure.classLevelId,
      academicYearId: structure.academicYearId,
      feeAmountKobo: 45_000_00,
    });
    const generated = await admin.api.post("invoices/arm/generate", {
      data: { termId: structure.termId, classArmId: structure.arms[0]!.id },
    });
    expect(generated.ok(), await generated.text()).toBe(true);
    const child = students[0]!;

    // The dashboard's Record Fee now opens this page, not the bills list.
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Record Fee" }).click({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/finance\/payments\/record$/);

    // Search by admission number: unique to this run, whatever else is in the database.
    await page.getByLabel("Student", { exact: true }).fill(child.admissionNumber);
    const results = page.getByRole("list", { name: "Students with unpaid bills" });
    await expect(results.getByRole("button")).toHaveCount(1, { timeout: 30_000 });
    await expect(results).toContainText("₦45,000.00");
    await results.getByRole("button").click();

    await expect(page.getByText("Term bill")).toBeVisible();
    await page.getByRole("button", { name: "Paid in full" }).click();
    await expect(page.getByLabel("Amount (₦)")).toHaveValue("45000");
    await page.getByLabel("Method").selectOption("POS");
    await page.getByRole("button", { name: "Record payment" }).click();

    await expect(page.getByRole("status")).toContainText("₦45,000.00 recorded");
    await expect(page.getByRole("status")).toContainText("paid in full");
    await expect(page.getByRole("button", { name: "Open receipt" })).toBeVisible();

    // The bill is paid, by the API's own account.
    const after = await admin.api.get(`invoices?studentId=${child.id}`);
    const body = (await after.json()) as { data: Array<{ status: string; totalPaid: number }> };
    expect(body.data[0]!.status).toBe("PAID");
    expect(body.data[0]!.totalPaid).toBe(45_000_00);

    // Paid bills drop out of the search.
    await page.getByRole("button", { name: "Record another" }).click();
    await page.getByLabel("Student", { exact: true }).fill(child.admissionNumber);
    await expect(page.getByText(/No unpaid bills for/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await close(admin);
  }
});
