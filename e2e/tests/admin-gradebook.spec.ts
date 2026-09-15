import { expect, test, type Page } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { seedTeacherInvitation } from "../fixtures/db.js";
import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import {
  armId,
  assignTeacher,
  createApiContext,
  inviteAndAcceptTeacher,
  loginAsAdmin,
  loginAsTeacher,
  setupAcademicStructure,
  uniqueSuffix,
} from "../fixtures/index.js";

// Owner/admin gradebook (/gradebook), 2026-09-15.
//
// The friction this closes, seen live with a lead: owners were allowed to enter
// scores (the API has accepted them, unscoped, since Phase 2 / Slice 2) but the
// only gradebook screen was the teacher's, so an owner had to invite themselves
// as a teacher to enter marks for their own school.
//
// The path, through the real UI, as the school OWNER:
//   1. The sidebar has Gradebook. Choosing a class lists every active subject:
//      the one with an assigned teacher first ("Teacher assigned"), a subject
//      nobody teaches ("No teacher assigned") still listed and openable.
//   2. Enter scores for the teacher's subject AND for the untaught subject; save;
//      totals come back from the server; sign off; recompute positions.
//   3. Build report cards for the class — the cards carry both subjects.
// Then, straight from the database and the reports API:
//   4. Every score row and audit row names the OWNER, never the class teacher.
//   5. Teacher Activity: the teacher's subject shows as entered by someone else
//      (entered 6, by this person 0); the owner is not a row. The untaught
//      subject's scores are reported under "unassigned", not dropped.
//   6. The teacher's own gradebook is unchanged and sees the owner's marks.
//   7. A bursar has no Gradebook in the sidebar and the score API refuses them.

const SHOTS = "test-results/admin-gradebook";
const TAUGHT = "Further Mathematics";
const UNTAUGHT = "Civic Education"; // seeded at signup; no teacher is assigned to it

async function enterColumn(page: Page, lastNames: string[], scores: [number, number, number][]) {
  for (const [i, last] of lastNames.entries()) {
    const [ca1, ca2, exam] = scores[i]!;
    await page.getByLabel(`${last} First CA`).fill(String(ca1));
    await page.getByLabel(`${last} Second CA`).fill(String(ca2));
    await page.getByLabel(`${last} Exam`).fill(String(exam));
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

test("an owner with no teacher identity enters scores, signs off and builds report cards; attribution stays theirs; a bursar is refused", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Gold", code: `jss2-gold-${suffix}` }],
    subjectName: TAUGHT,
    subjectCode: `fm-${suffix}`,
  });
  const classArmId = armId(structure, "JSS 2 Gold");
  const { termId } = structure;

  // Two enrolled students.
  const students = [
    { admissionNumber: `GB/${suffix}/1`, firstName: "Adaeze", lastName: "Okafor" },
    { admissionNumber: `GB/${suffix}/2`, firstName: "Bello", lastName: "Yusuf" },
  ];
  for (const s of students) {
    const created = await apiCreateStudent(admin.api, { ...s, dateOfBirth: "2012-05-14T00:00:00.000Z", gender: "FEMALE" });
    await apiCreateEnrollment(admin.api, { studentId: created.id, termId, classArmId });
  }

  // A real teacher, assigned to TAUGHT in this class — so the report has a
  // teacher whose subject someone else can fill in.
  const teacher = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  await teacher.context.close();
  await assignTeacher(admin.api, {
    teacherId: teacher.userId,
    classArmId,
    subjectId: structure.subjectId,
    academicYearId: structure.academicYearId,
  });

  const untaughtId = await withTenant(admin.schoolId, async (db) =>
    (await db.subject.findFirstOrThrow({ where: { name: UNTAUGHT }, select: { id: true } })).id,
  );
  const page = admin.page;

  try {
    // ---- 1. The picker ----------------------------------------------------
    await page.goto("/dashboard");
    // The dashboard writes its term into the URL once loaded; a click before
    // that lands is overwritten by its router.replace.
    await page.waitForURL(/\/dashboard\?termId=/, { timeout: 60_000 });
    await page.getByRole("link", { name: "Gradebook" }).first().click();
    await expect(page).toHaveURL(/\/gradebook$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Gradebook", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Class").selectOption({ label: "JSS 2 Gold" });
    await expect(page.getByLabel("Term")).toHaveValue(termId);

    const list = page.getByRole("list", { name: "Subjects" });
    const rows = list.getByRole("listitem");
    // The assigned subject is first; the untaught one is listed too.
    await expect(rows.first()).toContainText(TAUGHT);
    await expect(rows.first()).toContainText("Teacher assigned");
    await expect(list.getByRole("link", { name: new RegExp(UNTAUGHT) })).toContainText("No teacher assigned");
    // Every active subject is offered: the signup seed plus the fixture's one.
    const activeSubjects = await withTenant(admin.schoolId, (db) => db.subject.count({ where: { isActive: true } }));
    await expect(rows).toHaveCount(activeSubjects);
    await page.screenshot({ path: `${SHOTS}/1-picker.png`, fullPage: true });

    // ---- 2. The teacher's subject, entered by the owner -------------------
    await list.getByRole("link", { name: new RegExp(TAUGHT) }).click();
    await expect(page).toHaveURL(new RegExp(`/gradebook/${classArmId}/${structure.subjectId}\\?termId=${termId}`));
    await expect(page.getByRole("heading", { name: `${TAUGHT} — JSS 2 Gold` })).toBeVisible();

    await enterColumn(page, ["Okafor", "Yusuf"], [[15, 18, 50], [10, 12, 30]]);
    // Totals and grades are the server's, read back into read-only cells.
    const okafor = page.getByRole("row", { name: /Okafor/ });
    const yusuf = page.getByRole("row", { name: /Yusuf/ });
    await expect(okafor).toContainText("83");
    await expect(yusuf).toContainText("52");

    await page.getByRole("button", { name: "Recompute positions" }).click();
    await expect(page.getByText("Positions recomputed.")).toBeVisible();
    await page.getByRole("button", { name: "Sign off column" }).click();
    await expect(page.getByText(/^Signed off /)).toBeVisible();
    await expect(page.getByLabel("Okafor Exam")).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/2-taught-subject-signed-off.png`, fullPage: true });

    // ---- 2b. A subject nobody teaches --------------------------------------
    await page.getByRole("link", { name: "All subjects" }).click();
    await expect(page).toHaveURL(new RegExp(`/gradebook\\?armId=${classArmId}&termId=${termId}`));
    await expect(page.getByLabel("Class")).toHaveValue(classArmId);
    await page.getByRole("list", { name: "Subjects" }).getByRole("link", { name: new RegExp(UNTAUGHT) }).click();
    await expect(page.getByRole("heading", { name: `${UNTAUGHT} — JSS 2 Gold` })).toBeVisible();
    await enterColumn(page, ["Okafor", "Yusuf"], [[20, 20, 60], [5, 5, 20]]);
    await page.getByRole("button", { name: "Sign off column" }).click();
    await expect(page.getByText(/^Signed off /)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/3-untaught-subject-signed-off.png`, fullPage: true });

    // ---- 3. Report cards ----------------------------------------------------
    await page.goto(`/report-cards/${classArmId}?termId=${termId}`);
    await page.getByRole("button", { name: "Build report cards" }).click();
    await expect(page.getByText("Okafor").first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/4-report-cards-built.png`, fullPage: true });

    const cards = await withTenant(admin.schoolId, async (db) => {
      const rows = await db.reportCard.findMany({
        where: { termId, classArmId },
        select: { studentId: true, subjectsCount: true, overallTotal: true },
      });
      const names = new Map(
        (await db.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, lastName: true } })).map(
          (st) => [st.id, st.lastName],
        ),
      );
      return rows.map((r) => [names.get(r.studentId), r.subjectsCount, r.overallTotal]);
    });
    expect(cards.sort()).toEqual([
      ["Okafor", 2, 83 + 100],
      ["Yusuf", 2, 52 + 30],
    ]);

    // ---- 4. Attribution -----------------------------------------------------
    const attribution = await withTenant(admin.schoolId, async (db) => ({
      scoreEnteredBy: [
        ...new Set((await db.assessmentScore.findMany({ where: { termId }, select: { enteredBy: true } })).map((r) => r.enteredBy)),
      ],
      scoreCount: await db.assessmentScore.count({ where: { termId } }),
      signedOffBy: [
        ...new Set(
          (await db.assessment.findMany({ where: { termId }, select: { subjectSignedOffBy: true } })).map(
            (r) => r.subjectSignedOffBy,
          ),
        ),
      ],
      auditActors: [
        ...new Set(
          (
            await db.auditLog.findMany({
              where: { action: { in: ["assessment-score.create", "assessment.sign-off"] } },
              select: { userId: true },
            })
          ).map((r) => r.userId),
        ),
      ],
      auditCount: await db.auditLog.count({ where: { action: { in: ["assessment-score.create", "assessment.sign-off"] } } }),
    }));
    expect(attribution.scoreCount).toBe(12); // 2 students × 3 components × 2 subjects
    expect(attribution.scoreEnteredBy).toEqual([admin.ownerUserId]);
    expect(attribution.signedOffBy).toEqual([admin.ownerUserId]);
    expect(attribution.auditActors).toEqual([admin.ownerUserId]);
    expect(attribution.auditCount).toBe(4); // one bulk save + one sign-off, per subject

    // ---- 5. Reports: nothing downstream misattributes ----------------------
    const activity = await (await admin.api.get(`reports/teacher-activity?termId=${termId}`)).json();
    expect(activity.rows.map((r: { userId: string }) => r.userId)).toEqual([teacher.userId]);
    const row = activity.rows[0];
    expect(row.assignedSlotsExpected).toBe(6);
    expect(row.assignedSlotsEntered).toBe(6);
    expect(row.assignedSlotsEnteredByThisPerson).toBe(0);
    expect(row.lastScoreEnteredAt).toBeNull();

    const completeness = await (await admin.api.get(`reports/completeness?termId=${termId}`)).json();
    const taughtRow = completeness.scores.rows.find((r: { subjectId: string }) => r.subjectId === structure.subjectId);
    expect([taughtRow.slotsExpected, taughtRow.slotsEntered, taughtRow.studentsSignedOff]).toEqual([6, 6, 2]);
    expect(completeness.scores.unassigned).toEqual([
      expect.objectContaining({ groupId: classArmId, subjectId: untaughtId, subjectName: UNTAUGHT, slotsEntered: 6 }),
    ]);

    // ---- 6. The teacher's gradebook is unchanged and shows the owner's marks
    const teacherSession = await loginAsTeacher(browser, teacher.email, teacher.password);
    try {
      await teacherSession.page.goto(`/teacher/gradebook/${classArmId}/${structure.subjectId}`);
      await expect(teacherSession.page.getByRole("heading", { name: `${TAUGHT} — JSS 2 Gold` })).toBeVisible();
      await expect(teacherSession.page.getByLabel("Okafor Exam")).toHaveValue("50");
      // The untaught subject is still not the teacher's to open.
      await teacherSession.page.goto(`/teacher/gradebook/${classArmId}/${untaughtId}`);
      await expect(teacherSession.page.getByText("This isn't one of your classes.")).toBeVisible();
    } finally {
      await teacherSession.context.close();
    }

    // ---- 7. A bursar is refused --------------------------------------------
    const bursarEmail = `e2e-bursar-${suffix}@school-kit.test`;
    const { rawToken } = await seedTeacherInvitation({
      schoolId: admin.schoolId,
      invitedByUserId: admin.ownerUserId,
      email: bursarEmail,
      firstName: "Bisi",
      lastName: "Bursar",
      roleKey: "bursar",
    });
    const anon = await createApiContext();
    const accepted = await anon.post(`invitations/${rawToken}/accept`, {
      data: { firstName: "Bisi", lastName: "Bursar", password: "Password1!", ndprConsent: true },
    });
    expect(accepted.ok()).toBe(true);
    await anon.dispose();
    const bursar = await loginAsTeacher(browser, bursarEmail, "Password1!");
    const bursarApi = await createApiContext(bursar.token);
    try {
      await bursar.page.goto("/finance/dashboard");
      await expect(bursar.page.getByRole("link", { name: "Finance" }).first()).toBeVisible();
      await expect(bursar.page.getByRole("link", { name: "Gradebook" })).toHaveCount(0);
      const okaforId = await studentIdOf(admin.schoolId, "Okafor");
      const refused = await bursarApi.post("assessment-scores/bulk", {
        data: {
          termId,
          subjectId: structure.subjectId,
          rows: [{ studentId: okaforId, componentId: await examId(admin.schoolId), score: 1 }],
        },
      });
      expect(refused.status()).toBe(403);
      const unchanged = await withTenant(admin.schoolId, (db) =>
        db.assessmentScore.findMany({ where: { termId, subjectId: structure.subjectId, studentId: okaforId }, select: { score: true, enteredBy: true } }),
      );
      expect(unchanged.every((s) => s.enteredBy === admin.ownerUserId)).toBe(true);
      expect(unchanged.map((s) => s.score).sort((a, b) => a - b)).toEqual([15, 18, 50]);
    } finally {
      await bursarApi.dispose();
      await bursar.context.close();
    }
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});

async function studentIdOf(schoolId: string, lastName: string): Promise<string> {
  return withTenant(schoolId, async (db) => (await db.student.findFirstOrThrow({ where: { lastName }, select: { id: true } })).id);
}

async function examId(schoolId: string): Promise<string> {
  return withTenant(schoolId, async (db) => (await db.gradingComponent.findFirstOrThrow({ where: { label: "Exam" }, select: { id: true } })).id);
}
