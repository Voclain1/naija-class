import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { createApiContext, inviteAndAcceptTeacher, loginAsAdmin, loginAsTeacher, uniqueSuffix } from "../fixtures/index.js";

// Phase 8 / CP2 — Recording Completeness, the real end-to-end path.
// Plan-first: docs/modules/phase-8.md §16.5 item 6.
//
// FIXTURE (written directly, so every number on screen is known in advance):
//   a CURRENT term, Mon 2 – Fri 27 March 2026, which has therefore ENDED;
//   one class with two students enrolled; ONE register, Wed 4 March.
//
// Expected school days: 20 weekdays − Eid-el-Fitr (Thu 19, Fri 20; confirmed,
// seeded national holiday) = 18. The page must say "1 of 18 school days".
//
// Also: the teacher tab writes exactly one audit row when opened, and a teacher
// is refused both the page and the API.

const SHOTS = "test-results/recording-completeness";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("owner sees the ended term and '1 of 18 school days'; opening teacher activity is audited once; a teacher is refused", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const armName = `Completeness ${suffix}`;

  const { termId } = await withTenant(admin.schoolId, async (db) => {
    // Make THIS year and term current (the invariant setCurrentTerm keeps), so
    // the admin topbar's term selector and the report agree on the term.
    await db.term.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    await db.academicYear.updateMany({ where: { schoolId: admin.schoolId }, data: { isCurrent: false } });
    const year = await db.academicYear.create({
      data: { schoolId: admin.schoolId, label: `E2E-CMP-${suffix}`, startDate: d("2026-01-05"), endDate: d("2026-07-24"), isCurrent: true },
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
      data: { schoolId: admin.schoolId, classLevelId: level!.id, name: armName, code: `cmp-${suffix}` },
      select: { id: true },
    });
    for (const n of [1, 2]) {
      const st = await db.student.create({
        data: { schoolId: admin.schoolId, admissionNumber: `CMP-${suffix}-${n}`, firstName: `E2E${n}`, lastName: "Student", dateOfBirth: d("2014-01-01"), gender: "MALE" },
        select: { id: true },
      });
      await db.enrollment.create({ data: { schoolId: admin.schoolId, studentId: st.id, termId: term.id, academicYearId: year.id, classArmId: arm.id } });
      await db.attendanceRecord.create({
        data: { schoolId: admin.schoolId, studentId: st.id, classArmId: arm.id, termId: term.id, date: d("2026-03-04"), status: "PRESENT", markedBy: admin.ownerUserId },
      });
    }
    return { termId: term.id };
  });

  const auditViews = () =>
    withTenant(admin.schoolId, (db) => db.auditLog.count({ where: { action: "reports.teacher-activity.view" } }));

  const teacher = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  const teacherSession = await loginAsTeacher(browser, teacher.email, teacher.password);
  const teacherApi = await createApiContext(teacherSession.token);

  try {
    // ---- 1. The dashboard alert (Q33) reflects the same computation --------
    const dash = await admin.api.get(`dashboard?termId=${termId}`);
    expect(dash.ok(), await dash.text()).toBe(true);
    const alert = ((await dash.json()) as { needsYouToday: Array<{ type: string; count: number; href: string }> }).needsYouToday.find(
      (a) => a.type === "term_health",
    );
    expect(alert?.href).toBe("/reports");
    expect(alert!.count).toBeGreaterThanOrEqual(1);

    // ---- 2. The owner opens /reports through the sidebar ------------------
    await admin.page.goto("/dashboard");
    // Wait for the dashboard's own ?termId= replace to land first: clicking a
    // sidebar link before it does is the pre-existing /dashboard navigation race
    // recorded in docs/deferred.md, not something this checkpoint introduced.
    await expect(admin.page).toHaveURL(/\/dashboard\?termId=/, { timeout: 60_000 });
    await admin.page.getByRole("link", { name: "Reports" }).first().click();
    await expect(admin.page).toHaveURL(/\/reports/);
    // Pin the fixture's term explicitly (the topbar selector appends ?termId=).
    // Generous timeout: Next dev mode compiles /reports on first request (~15s).
    await admin.page.goto(`/reports?termId=${termId}`);
    await expect(admin.page.getByRole("heading", { name: "Recording completeness", level: 1 })).toBeVisible({ timeout: 60_000 });

    // The ended term, with its fix link.
    const ended = admin.page.getByRole("status").filter({ hasText: "The current term ended on Fri 27 Mar 2026" });
    await expect(ended).toBeVisible();
    await expect(ended.getByRole("link", { name: "Fix this" })).toHaveAttribute("href", "/settings/academic");

    // 18 school days, and one register on the one class.
    await expect(admin.page.getByText("counted up to Fri 27 Mar 2026: 18 school days")).toBeVisible();
    const registers = admin.page.getByRole("region", { name: "Daily registers" });
    await expect(registers.getByText("1 of 18 class registers taken.")).toBeVisible();
    await expect(registers.getByRole("row").filter({ hasText: armName })).toContainText("1 of 18 school days");
    // Report-card pipeline for the same class: two enrolled students, no cards built.
    const cards = admin.page.getByRole("region", { name: "Report cards" });
    await expect(cards.getByText("2 students with no card yet")).toBeVisible();
    await admin.page.getByText("2 weekdays not counted as school days").click();
    await expect(admin.page.getByText("Thu 19 Mar 2026 — Eid-el-Fitr (public holiday)")).toBeVisible();
    await admin.page.screenshot({ path: `${SHOTS}/1-owner-report.png`, fullPage: true });

    // Nothing on this page is a mark or a grade.
    const body = await admin.page.locator("main").innerText();
    expect(body).not.toMatch(/\baverage\b|\bposition\b|\bpass rate\b/i);

    // ---- 3. Opening the teacher tab writes exactly ONE audit row ----------
    expect(await auditViews()).toBe(0);
    await admin.page.getByRole("tab", { name: "Teacher recording activity" }).click();
    await expect(
      admin.page.getByText("Recording activity only — what has been entered, not how students performed or how well anyone teaches."),
    ).toBeVisible();
    await expect(admin.page.getByRole("row").filter({ hasText: teacher.firstName })).toBeVisible();
    await expect.poll(auditViews, { timeout: 5_000 }).toBe(1);
    // Give a stray duplicate request (e.g. a double-mounted effect) time to land, then re-check.
    await admin.page.waitForTimeout(1_500);
    expect(await auditViews()).toBe(1);
    await admin.page.screenshot({ path: `${SHOTS}/2-teacher-activity.png`, fullPage: true });

    // ---- 4. A teacher is refused the page and the API ---------------------
    for (const path of [`reports/completeness?termId=${termId}`, `reports/teacher-activity?termId=${termId}`]) {
      const res = await teacherApi.get(path);
      expect(res.status(), path).toBe(403);
    }
    expect(await auditViews()).toBe(1); // the refused teacher request wrote nothing

    await teacherSession.page.goto("/reports");
    await expect(teacherSession.page).not.toHaveURL(/\/reports$/);
    await expect(teacherSession.page.getByRole("heading", { name: "Recording completeness" })).toHaveCount(0);
  } finally {
    await teacherApi.dispose();
    await teacherSession.context.close();
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
