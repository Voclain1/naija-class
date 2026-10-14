import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { createApiContext, inviteAndAcceptTeacher, loginAsAdmin, loginAsTeacher, uniqueSuffix } from "../fixtures/index.js";

// Phase 9 / CP1.1 — Excel and PDF copies of the reports (docs/modules/phase-9.md §8.5).
//
// Through the real UI, as the school owner, on the registers table:
//   1. Export → Excel downloads a real workbook named after the term, and the
//      copy is audited with its row count.
//   2. Export → CSV still downloads from the browser, as before.
//   3. Export → PDF queues a copy the API knows about (the render worker is
//      not running here, so it stays PENDING; printing is pinned by
//      report-exports.service.spec.ts).
// And a teacher is refused every export route.

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("owner downloads the registers report as Excel and CSV and queues a PDF; a teacher is refused", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const armName = `Exports ${suffix}`;

  const { termId } = await withTenant(admin.schoolId, async (db) => {
    await db.term.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    await db.academicYear.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    const year = await db.academicYear.create({
      data: { schoolId: admin.schoolId, label: `E2E-EXP-${suffix}`, startDate: d("2026-01-05"), endDate: d("2026-07-24"), isCurrent: true },
      select: { id: true },
    });
    const term = await db.term.create({
      data: {
        schoolId: admin.schoolId, academicYearId: year.id, sequence: 2, name: "Spring Term",
        startDate: d("2026-03-02"), endDate: d("2026-03-27"), isCurrent: true,
      },
      select: { id: true },
    });
    const level = await db.classLevel.findFirst({ where: { schoolId: admin.schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
    const arm = await db.classArm.create({
      data: { schoolId: admin.schoolId, classLevelId: level!.id, name: armName, code: `exp-${suffix}` },
      select: { id: true },
    });
    const st = await db.student.create({
      data: { schoolId: admin.schoolId, admissionNumber: `EXP-${suffix}-1`, firstName: "E2E", lastName: "Student", dateOfBirth: d("2014-01-01"), gender: "MALE" },
      select: { id: true },
    });
    await db.enrollment.create({ data: { schoolId: admin.schoolId, studentId: st.id, termId: term.id, academicYearId: year.id, classArmId: arm.id } });
    await db.attendanceRecord.create({
      data: { schoolId: admin.schoolId, studentId: st.id, classArmId: arm.id, termId: term.id, date: d("2026-03-04"), status: "PRESENT", markedBy: admin.ownerUserId },
    });
    return { termId: term.id };
  });

  const exportAudits = () =>
    withTenant(admin.schoolId, (db) =>
      db.auditLog.findMany({ where: { action: "reports.export" }, select: { metadata: true }, orderBy: { createdAt: "asc" } }),
    );

  const teacher = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  const teacherSession = await loginAsTeacher(browser, teacher.email, teacher.password);
  const teacherApi = await createApiContext(teacherSession.token);

  try {
    const page = admin.page;
    await page.goto(`/reports?termId=${termId}`);
    await expect(page.getByRole("heading", { name: "Recording completeness", level: 1 })).toBeVisible({ timeout: 60_000 });
    const registers = page.getByRole("region", { name: "Daily registers" });
    await expect(registers.getByRole("row").filter({ hasText: armName })).toBeVisible();

    // ---- 1. Excel -----------------------------------------------------------
    await registers.getByRole("button", { name: "Export" }).click();
    const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Excel" }).click()]);
    expect(xlsx.suggestedFilename()).toMatch(/^registers-spring-term-e2e-exp-.+\.xlsx$/);
    const bytes = readFileSync((await xlsx.path())!);
    expect(bytes.subarray(0, 2).toString()).toBe("PK"); // a zip, as every .xlsx is
    await expect.poll(async () => (await exportAudits()).length).toBe(1);
    expect((await exportAudits())[0]!.metadata).toEqual({ report: "completeness-registers", format: "xlsx", rows: 1 });

    // ---- 2. CSV, still from the browser --------------------------------------
    await registers.getByRole("button", { name: "Export" }).click();
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "CSV" }).click()]);
    expect(csv.suggestedFilename()).toMatch(/^registers-.*\.csv$/);
    expect(readFileSync((await csv.path())!, "utf8")).toContain(armName);

    // ---- 3. PDF is queued and the page says it is being prepared ------------
    await registers.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "PDF" }).click();
    await expect(page.getByText("Preparing the PDF")).toBeVisible();
    await expect
      .poll(() => withTenant(admin.schoolId, (db) => db.reportExport.count({ where: { report: "completeness-registers" } })))
      .toBe(1);

    // ---- 4. A teacher is refused every export route --------------------------
    const refused = [
      teacherApi.get(`reports/completeness/export?section=registers&termId=${termId}`),
      teacherApi.get(`reports/teacher-activity/export?termId=${termId}`),
      teacherApi.post("reports/completeness/pdf", { data: { section: "registers", termId } }),
      teacherApi.post("reports/teacher-activity/pdf", { data: { termId } }),
    ];
    for (const res of await Promise.all(refused)) expect(res.status(), res.url()).toBe(403);
  } finally {
    await teacherApi.dispose();
    await teacherSession.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
