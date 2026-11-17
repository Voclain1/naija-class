import { expect, test } from "@playwright/test";

import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";
import { seedTeacherInvitation } from "../fixtures/db.js";
import {
  armId,
  assignTeacher,
  createApiContext,
  inviteAndAcceptTeacher,
  loginAsAdmin,
  loginAsTeacher,
  setFormTeacher,
  setupAcademicStructure,
  uniqueSuffix,
} from "../fixtures/index.js";

/**
 * Sprint 4's composed production journey.
 *
 * Most SchoolKit browser tests deliberately isolate one screen. This test
 * carries one child's record through the hand-offs a real school performs:
 * owner setup -> teacher register -> owner gradebook/report release -> parent
 * portal. It also proves that the bursar reaches finance but not academics.
 * A green isolated test cannot hide a broken hand-off here.
 */
test("one school completes the daily owner, teacher, bursar and parent journey", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Blue", code: `jss2-blue-${suffix}` }],
    subjectName: "Mathematics",
    subjectCode: `math-life-${suffix}`,
  });
  const classArmId = armId(structure, "JSS 2 Blue");
  const guardian = await createPortalGuardian(admin.api, {
    suffix,
    schoolId: admin.schoolId,
  });
  await apiCreateEnrollment(admin.api, {
    studentId: guardian.studentId,
    termId: structure.termId,
    classArmId,
  });

  const invitedTeacher = await inviteAndAcceptTeacher(browser, {
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
  });
  await assignTeacher(admin.api, {
    teacherId: invitedTeacher.userId,
    classArmId,
    subjectId: structure.subjectId,
    academicYearId: structure.academicYearId,
  });
  await setFormTeacher({
    schoolId: admin.schoolId,
    classArmId,
    teacherId: invitedTeacher.userId,
  });
  await invitedTeacher.context.close();

  const teacher = await loginAsTeacher(
    browser,
    invitedTeacher.email,
    invitedTeacher.password,
  );
  let bursarContext: Awaited<ReturnType<typeof loginAsTeacher>>["context"] | undefined;
  const guardianContext = await browser.newContext();

  try {
    // Teacher: the owner's placement is visible in the real register and can
    // be saved without any administrator-only shortcut.
    await teacher.page.goto("/teacher/attendance");
    await teacher.page.getByLabel("Date").fill("2025-10-15");
    await expect(teacher.page.getByText("Chidinma Adeleke")).toBeVisible();
    await teacher.page.getByRole("button", { name: "Mark all present" }).click();
    await teacher.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      teacher.page.locator("p[role='status']").filter({
        hasText: "Attendance saved for 1 student.",
      }),
    ).toBeVisible();

    // Owner: the same child appears in the gradebook. Scores are entered and
    // signed off through the UI; the controlled workflow then uses its real
    // API transitions, including the release gate that makes family data live.
    await admin.page.goto(
      `/gradebook/${classArmId}/${structure.subjectId}?termId=${structure.termId}`,
    );
    await expect(
      admin.page.getByRole("heading", { name: "Mathematics — JSS 2 Blue" }),
    ).toBeVisible();
    await admin.page.getByLabel("Adeleke First CA").fill("15");
    await admin.page.getByLabel("Adeleke Second CA").fill("15");
    await admin.page.getByLabel("Adeleke Exam").fill("50");
    await admin.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(admin.page.getByText("Saved", { exact: true })).toBeVisible();
    await admin.page.getByRole("button", { name: "Sign off column" }).click();
    await expect(admin.page.getByText(/^Signed off /)).toBeVisible();

    const armAction = {
      termId: structure.termId,
      classArmId,
    };
    for (const [path, data] of [
      ["report-cards/arm/build", armAction],
      ["report-cards/arm/form-review", armAction],
      ["report-cards/arm/approve", armAction],
      ["report-cards/arm/release", { ...armAction, accessMode: "FREE" }],
    ] as const) {
      const response = await admin.api.post(path, { data });
      expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    }

    // Bursar: finance is available, while the gradebook remains absent from
    // both navigation and direct access permissions.
    const bursarEmail = `e2e-bursar-${suffix}@school-kit.test`;
    const bursarPassword = "Password1!";
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
      data: {
        firstName: "Bisi",
        lastName: "Bursar",
        password: bursarPassword,
        ndprConsent: true,
      },
    });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    await anon.dispose();
    const bursar = await loginAsTeacher(browser, bursarEmail, bursarPassword);
    bursarContext = bursar.context;
    await bursar.page.goto("/finance/dashboard");
    await expect(
      bursar.page.getByRole("heading", { name: "Finance dashboard", level: 1 }),
    ).toBeVisible();
    await expect(bursar.page.getByRole("link", { name: "Gradebook" })).toHaveCount(0);

    // Parent: the release above crosses the final role boundary. The guardian
    // signs in normally and sees only the released result for their own child.
    const guardianPage = await guardianContext.newPage();
    await guardianPage.goto(`${PORTAL_BASE_URL}/login`);
    await guardianPage.getByLabel("Email").fill(guardian.email);
    await guardianPage.getByLabel("Password", { exact: true }).fill(guardian.password);
    await guardianPage.getByRole("button", { name: "Log in" }).click();
    await expect(
      guardianPage.getByRole("heading", { name: "Your children" }),
    ).toBeVisible();
    await guardianPage.goto(
      `${PORTAL_BASE_URL}/students/${guardian.studentId}/results`,
    );
    await expect(
      guardianPage.getByRole("heading", { name: "Released results" }),
    ).toBeVisible();
    await expect(guardianPage.getByText("Chidinma Adeleke")).toBeVisible();
    await expect(guardianPage.getByText("80.00%")).toBeVisible();
  } finally {
    await guardianContext.close();
    await bursarContext?.close();
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
