import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { seedTeacherInvitation } from "../fixtures/db.js";
import { apiCreateStudent } from "../fixtures/finance.js";
import { createApiContext, loginAsAdmin, loginAsTeacher, uniqueSuffix } from "../fixtures/index.js";

// Phase 9 / CP1.3 — Excel and PDF of a list already on screen
// (docs/modules/phase-9.md §8.9 CP1-D10). Through the real UI, as the owner,
// on the Students list:
//   1. Export → Excel downloads a real workbook, audited as export.table.
//   2. Export → CSV still downloads from the browser.
//   3. Export → PDF queues a copy (the render worker is not running here).
// Then the route itself: a bursar may use it (it grants no data), and a table
// whose rows do not match its columns is refused.

const table = (title: string, rows: unknown[][]) => ({
  name: "table.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ title, subtitle: null, columns: [{ header: "Name" }, { header: "Owed", numeric: true }], rows })),
});

test("owner exports the student list as Excel, CSV and PDF; a bursar may use the formatter; a bad table is refused", async ({
  browser,
}) => {
  test.setTimeout(4 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  await apiCreateStudent(admin.api, {
    admissionNumber: `LX-${suffix}`,
    firstName: "Zainab",
    lastName: `Export${suffix}`,
    dateOfBirth: "2014-02-01",
    gender: "FEMALE",
  });

  const audits = () =>
    withTenant(admin.schoolId, (db) =>
      db.auditLog.findMany({ where: { action: "export.table" }, select: { metadata: true }, orderBy: { createdAt: "asc" } }),
    );

  try {
    const page = admin.page;
    await page.goto("/students");
    await expect(page.getByText(`Export${suffix}`)).toBeVisible({ timeout: 60_000 });

    // ---- 1. Excel ------------------------------------------------------------
    await page.getByRole("button", { name: "Export" }).click();
    const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Excel" }).click()]);
    expect(xlsx.suggestedFilename()).toBe("students.xlsx");
    expect(readFileSync((await xlsx.path())!).subarray(0, 2).toString()).toBe("PK");
    await expect.poll(async () => (await audits()).length).toBe(1);
    expect((await audits())[0]!.metadata).toMatchObject({ title: "Students", format: "xlsx" });

    // ---- 2. CSV, unchanged -----------------------------------------------------
    await page.getByRole("button", { name: "Export" }).click();
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "CSV" }).click()]);
    expect(csv.suggestedFilename()).toBe("students.csv");
    expect(readFileSync((await csv.path())!, "utf8")).toContain(`Export${suffix}`);

    // ---- 3. PDF is queued --------------------------------------------------------
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "PDF" }).click();
    await expect(page.getByText("Preparing the PDF")).toBeVisible();
    await expect
      .poll(() => withTenant(admin.schoolId, (db) => db.reportExport.count({ where: { report: "table" } })))
      .toBe(1);
  } finally {
    await admin.context.close();
  }

  // ---- 4. The route: a bursar may format a table; a malformed one is refused ---
  const bursarEmail = `e2e-bursar-lx-${suffix}@school-kit.test`;
  const { rawToken } = await seedTeacherInvitation({
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
    email: bursarEmail,
    firstName: "Bisi",
    lastName: "Bursar",
    roleKey: "bursar",
  });
  const anon = await createApiContext();
  expect(
    (await anon.post(`invitations/${rawToken}/accept`, {
      data: { firstName: "Bisi", lastName: "Bursar", password: "Password1!", ndprConsent: true },
    })).ok(),
  ).toBe(true);
  await anon.dispose();
  const bursar = await loginAsTeacher(browser, bursarEmail, "Password1!");
  const bursarApi = await createApiContext(bursar.token);
  try {
    const ok = await bursarApi.post("exports/table/xlsx", { multipart: { table: table("Debtors", [["Ada", 1200]]) } });
    expect(ok.status(), await ok.text()).toBe(200);
    expect(ok.headers()["content-disposition"]).toContain("debtors.xlsx");

    const bad = await bursarApi.post("exports/table/xlsx", { multipart: { table: table("Debtors", [["only one cell"]]) } });
    expect(bad.status()).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("INVALID_TABLE");
  } finally {
    await bursarApi.dispose();
    await bursar.context.close();
    await admin.api.dispose();
  }
});
