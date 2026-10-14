import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { createApiContext, inviteAndAcceptTeacher, loginAsAdmin, loginAsTeacher, uniqueSuffix } from "../fixtures/index.js";

// Phase 9 / CP1.2 — the Academic, Attendance and Enrolment tabs
// (docs/modules/phase-9.md §8.5). Through the real UI, as the school owner:
//   1. Academic: the class average from two RELEASED cards (80 and 60 → 70.00);
//      a third card still in DRAFT changes nothing. Excel downloads.
//   2. Attendance: a student at 50% is listed as often absent; the line is the
//      school's 90% default.
//   3. Enrolment: three students on roll this term.
//   4. Settings: the often-absent line can be changed, and the report follows.
// And a teacher is refused all three reads.

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("owner reads the Academic, Attendance and Enrolment tabs; the often-absent line follows Settings; a teacher is refused", async ({
  browser,
}) => {
  test.setTimeout(5 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const armName = `Analytics ${suffix}`;

  const { termId } = await withTenant(admin.schoolId, async (db) => {
    await db.term.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    await db.academicYear.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    const year = await db.academicYear.create({
      data: { schoolId: admin.schoolId, label: `E2E-ANA-${suffix}`, startDate: d("2026-01-05"), endDate: d("2026-07-24"), isCurrent: true },
      select: { id: true },
    });
    const term = await db.term.create({
      data: { schoolId: admin.schoolId, academicYearId: year.id, sequence: 2, name: "Spring Term", startDate: d("2026-03-02"), endDate: d("2026-03-27"), isCurrent: true },
      select: { id: true },
    });
    const level = await db.classLevel.findFirst({ where: { schoolId: admin.schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
    const arm = await db.classArm.create({
      data: { schoolId: admin.schoolId, classLevelId: level!.id, name: armName, code: `ana-${suffix}` },
      select: { id: true },
    });
    const students: string[] = [];
    for (const [n, first] of [[1, "Ada"], [2, "Bayo"], [3, "Chidi"]] as const) {
      const st = await db.student.create({
        data: { schoolId: admin.schoolId, admissionNumber: `ANA-${suffix}-${n}`, firstName: first, lastName: "Okoro", dateOfBirth: d("2014-01-01"), gender: "MALE" },
        select: { id: true },
      });
      students.push(st.id);
      await db.enrollment.create({ data: { schoolId: admin.schoolId, studentId: st.id, termId: term.id, academicYearId: year.id, classArmId: arm.id } });
    }
    const [ada, bayo, chidi] = students as [string, string, string];
    for (const [studentId, status, overallAverage] of [[ada, "RELEASED", 8000], [bayo, "RELEASED", 6000], [chidi, "DRAFT", 9900]] as const) {
      await db.reportCard.create({ data: { schoolId: admin.schoolId, studentId, termId: term.id, academicYearId: year.id, classArmId: arm.id, status, overallAverage } });
    }
    // Two marked days: Ada present both, Bayo absent once (50%), Chidi present both.
    for (const [studentId, statuses] of [[ada, ["PRESENT", "PRESENT"]], [bayo, ["PRESENT", "ABSENT"]], [chidi, ["PRESENT", "PRESENT"]]] as const) {
      for (const [i, date] of ["2026-03-03", "2026-03-04"].entries()) {
        await db.attendanceRecord.create({
          data: { schoolId: admin.schoolId, studentId, classArmId: arm.id, termId: term.id, date: d(date), status: statuses[i]!, markedBy: admin.ownerUserId },
        });
      }
    }
    return { termId: term.id };
  });

  const teacher = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  const teacherSession = await loginAsTeacher(browser, teacher.email, teacher.password);
  const teacherApi = await createApiContext(teacherSession.token);

  try {
    const page = admin.page;

    // ---- 1. Academic -----------------------------------------------------------
    await page.goto(`/reports/academic?termId=${termId}`);
    await expect(page.getByRole("heading", { name: "Academic results", level: 1 })).toBeVisible({ timeout: 60_000 });
    const averages = page.getByRole("region", { name: "Class averages" });
    const row = averages.getByRole("row").filter({ hasText: armName });
    await expect(row).toContainText("70.00");
    await expect(row).toContainText("2"); // two released cards counted, not three
    await expect(page.getByRole("region", { name: "Top and bottom students" })).toContainText("Ada Okoro");
    await expect(page.getByRole("region", { name: "Top and bottom students" })).not.toContainText("Chidi Okoro");

    await averages.getByRole("button", { name: "Export" }).click();
    const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Excel (whole report)" }).click()]);
    expect(xlsx.suggestedFilename()).toMatch(/^academic-report-spring-term-.+\.xlsx$/);
    expect(readFileSync((await xlsx.path())!).subarray(0, 2).toString()).toBe("PK");

    // ---- 2. Attendance, via the section tabs ----------------------------------
    await page.getByRole("navigation", { name: "Report sections" }).getByRole("link", { name: "Attendance" }).click();
    await expect(page.getByRole("heading", { name: "Attendance", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.goto(`/reports/attendance?termId=${termId}`);
    const often = page.getByRole("region", { name: "Often absent — below 90%" });
    await expect(often.getByRole("row").filter({ hasText: "Bayo Okoro" })).toContainText("50.00%");
    await expect(often).not.toContainText("Ada Okoro");

    // ---- 3. Enrolment ----------------------------------------------------------
    await page.goto(`/reports/enrolment?termId=${termId}`);
    await expect(page.getByRole("heading", { name: "Enrolment", level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "Students per level" }).getByRole("row").filter({ hasText: "All levels" })).toContainText("3");

    // ---- 4. The often-absent line follows Settings ------------------------------
    await page.goto("/settings/attendance");
    const line = page.getByLabel("List students below (%)");
    await expect(line).toHaveValue("90", { timeout: 60_000 });
    await line.fill("40");
    await expect(page.getByText("A whole number from 50 to 100.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Often absent" }).getByRole("button", { name: "Save" })).toBeDisabled();
    await line.fill("50");
    await page.getByRole("region", { name: "Often absent" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Students below 50% attendance will be listed.")).toBeVisible();
    await page.goto(`/reports/attendance?termId=${termId}`);
    await expect(page.getByRole("region", { name: "Often absent — below 50%" })).toContainText("No student is below 50% this term.", {
      timeout: 60_000,
    });

    // ---- 5. A teacher is refused ------------------------------------------------
    for (const path of ["academic", "attendance", "enrolment"]) {
      const res = await teacherApi.get(`reports/${path}?termId=${termId}`);
      expect(res.status(), path).toBe(403);
    }
  } finally {
    await teacherApi.dispose();
    await teacherSession.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
