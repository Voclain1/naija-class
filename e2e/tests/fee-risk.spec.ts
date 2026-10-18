import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Phase 9 / CP10.2 — fee-default risk (docs/modules/phase-9.md §19.3), in a
// real browser: a child still owing from an earlier term shows "High" with
// the reason on the debtors page, the Risk filter keeps or hides the row, and
// the student page carries the same line.

test("the debtors page shows each child's risk level and its reasons", async ({ browser }) => {
  test.setTimeout(4 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { subjectCode: `risk-${suffix}` });

  const res = await admin.api.post("students", {
    data: { admissionNumber: `SKA/RISK/${suffix}`, firstName: "Ifeoma", lastName: `Risk${suffix}`, dateOfBirth: "2013-04-02T00:00:00.000Z", gender: "FEMALE" },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const studentId = ((await res.json()) as { id: string }).id;
  const name = `Ifeoma Risk${suffix}`;

  let yearLabel = "";
  await withTenant(admin.schoolId, async (db) => {
    const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
    yearLabel = (await db.academicYear.findUniqueOrThrow({ where: { id: structure.academicYearId }, select: { label: true } })).label;
    // An earlier term, long before the fixture's, with a balance still open.
    const oldYear = await db.academicYear.create({
      data: { schoolId: admin.schoolId, label: `Risk ${suffix}`, startDate: d("2001-09-01"), endDate: d("2002-07-31") },
      select: { id: true },
    });
    const oldTerm = await db.term.create({
      data: { schoolId: admin.schoolId, academicYearId: oldYear.id, sequence: 2, name: "Second Term", startDate: d("2002-01-07"), endDate: d("2002-04-05") },
      select: { id: true },
    });
    const invoice = (termId: string, academicYearId: string, dueDate: string) => ({
      schoolId: admin.schoolId,
      studentId,
      termId,
      academicYearId,
      status: "ISSUED" as const,
      items: [],
      totalAmount: 4_500_000,
      totalDiscount: 0,
      totalDue: 4_500_000,
      totalPaid: 0,
      dueDate: d(dueDate),
      issuedAt: new Date(),
      issuedBy: admin.ownerUserId,
    });
    await db.invoice.create({ data: invoice(oldTerm.id, oldYear.id, "2002-02-01") });
    await db.invoice.create({ data: invoice(structure.termId, structure.academicYearId, "2099-12-31") });
  });

  const page = admin.page;
  await page.goto("/finance/debtors");
  await page.getByLabel("Academic year").selectOption({ label: yearLabel });
  await page.getByLabel("Term").selectOption({ label: "First Term" });

  const risk = page.getByLabel(`Risk for ${name}`);
  await expect(risk.getByText("High", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(risk.getByText(`₦45,000.00 still owing from Second Term Risk ${suffix}`)).toBeVisible();
  await expect(page.getByText(/never shown to families/)).toBeVisible();

  // The Risk filter keeps or hides the row.
  await page.getByLabel("Risk", { exact: true }).selectOption({ label: "Low" });
  await expect(page.getByLabel(`Risk for ${name}`)).toHaveCount(0);
  await page.getByLabel("Risk", { exact: true }).selectOption({ label: "High" });
  await expect(page.getByLabel(`Risk for ${name}`)).toBeVisible();

  // The student page says the same, for staff only.
  await page.goto(`/students/${studentId}`);
  const line = page.getByLabel("Fee payment risk");
  await expect(line.getByText("High", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(line.getByText(`₦45,000.00 still owing from Second Term Risk ${suffix}`)).toBeVisible();

  await admin.context.close();
  await admin.api.dispose();
});
