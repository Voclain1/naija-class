import { expect, test } from "@playwright/test";
import { withTenant } from "@school-kit/db";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";
import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

test("fictional instalment schedule is visible to staff and guardian on mobile", async ({ browser }, testInfo) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const guardianContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const academic = await setupAcademicStructure(admin.api);
    const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
    const invoice = await withTenant(admin.schoolId, (db) => db.invoice.create({
      data: {
        schoolId: admin.schoolId, studentId: guardian.studentId, academicYearId: academic.academicYearId,
        termId: academic.termId, status: "ISSUED", items: [], totalAmount: 3000000, totalDue: 3000000,
        totalDiscount: 0, totalPaid: 0, issuedAt: new Date(), issuedBy: admin.ownerUserId,
      },
    }));
    const plan = await admin.api.post("payment-plans", { data: {
      invoiceId: invoice.id,
      name: "Three-part fee plan",
      installments: [1, 2, 3].map((n) => ({ amount: 1000000, dueDate: "2027-0" + n + "-01" })),
    } });
    expect(plan.ok(), await plan.text()).toBe(true);
    await admin.page.goto("/finance/invoices/" + invoice.id);
    await expect(admin.page.getByRole("button", { name: "Copy plan" })).toBeVisible();
    const staffImage = testInfo.outputPath("instalments-staff-preview.png");
    await admin.page.screenshot({ path: staffImage, fullPage: true });
    await testInfo.attach("instalments-staff-preview", { path: staffImage, contentType: "image/png" });

    const parent = await guardianContext.newPage();
    await parent.goto(PORTAL_BASE_URL + "/login");
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible();
    await parent.goto(PORTAL_BASE_URL + "/students/" + guardian.studentId);
    const schedule = parent.getByRole("heading", { name: "Payment schedule" });
    await expect(schedule).toBeVisible();
    await expect(parent.getByRole("button", { name: /Pay.*10,000/ })).toHaveCount(3);
    const guardianImage = testInfo.outputPath("instalments-guardian-preview.png");
    await parent.screenshot({ path: guardianImage, fullPage: true });
    await testInfo.attach("instalments-guardian-preview", { path: guardianImage, contentType: "image/png" });
  } finally {
    await guardianContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
