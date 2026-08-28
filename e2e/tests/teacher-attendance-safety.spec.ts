import { expect, test } from "@playwright/test";

import {
  armId,
  assignTeacher,
  inviteAndAcceptTeacher,
  loginAsAdmin,
  loginAsTeacher,
  seedAttendanceRoster,
  setFormTeacher,
  setupAcademicStructure,
  uniqueSuffix,
} from "../fixtures/index.js";

const REGISTER_DATE = "2025-10-15";

async function seedManagerRegister(browser: Parameters<typeof loginAsAdmin>[0]) {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const academic = await setupAcademicStructure(admin.api, {
    arms: [
      { name: "JSS 2 Blue", code: `jss2-blue-${suffix}` },
      { name: "JSS 2 Gold", code: `jss2-gold-${suffix}` },
    ],
  });
  const blueArmId = armId(academic, "JSS 2 Blue");
  await seedAttendanceRoster(admin.api, {
    schoolId: admin.schoolId,
    termId: academic.termId,
    classArmId: blueArmId,
    suffix,
    count: 4,
  });
  return { admin, academic, blueArmId };
}

async function openRegister(page: Awaited<ReturnType<typeof loginAsAdmin>>["page"]) {
  await page.goto("/teacher/attendance");
  if ((await page.getByLabel("Class").inputValue()) === "") {
    await page.getByLabel("Class").selectOption({ label: "JSS 2 Blue" });
  }
  await page.getByLabel("Date").fill(REGISTER_DATE);
  await page.getByRole("button", { name: "Mark all present" }).waitFor();
}

test("dirty attendance cannot be discarded by date, class, link, or browser Back", async ({ browser }) => {
  const { admin } = await seedManagerRegister(browser);
  try {
    const { page } = admin;
    await page.goto("/teacher/dashboard");
    await openRegister(page);
    await page.getByRole("button", { name: "Mark all present" }).click();
    await expect(page.getByText("4 unsaved attendance changes.")).toBeVisible();

    const dateDialog = page.waitForEvent("dialog");
    void page.getByLabel("Date").fill("2025-10-16");
    await (await dateDialog).dismiss();
    await expect(page.getByLabel("Date")).toHaveValue(REGISTER_DATE);
    await expect(page.getByText("4 unsaved attendance changes.")).toBeVisible();

    const selectedBlueArmId = await page.getByLabel("Class").inputValue();
    const classDialog = page.waitForEvent("dialog");
    void page.getByLabel("Class").selectOption({ label: "JSS 2 Gold" });
    await (await classDialog).dismiss();
    await expect(page.getByLabel("Class")).toHaveValue(selectedBlueArmId);

    const linkDialog = page.waitForEvent("dialog");
    void page.getByRole("link", { name: /Term summary/ }).click();
    await (await linkDialog).dismiss();
    await expect(page).toHaveURL(/\/teacher\/attendance$/);

    const backDialog = page.waitForEvent("dialog");
    void page.evaluate(() => window.history.back());
    await (await backDialog).dismiss();
    await expect(page).toHaveURL(/\/teacher\/attendance$/);
    await expect(page.getByText("4 unsaved attendance changes.")).toBeVisible();
  } finally {
    await admin.api.dispose();
    await admin.context.close();
  }
});

test("failed attendance saves retain edits, retry, and pause duplicate submission", async ({ browser }) => {
  const { admin } = await seedManagerRegister(browser);
  try {
    const { page } = admin;
    await openRegister(page);
    await page.getByRole("button", { name: "Mark all present" }).click();

    let attempts = 0;
    await page.route("**/attendance/mark", async (route) => {
      attempts += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Temporary service issue"}' });
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Your changes are still here." })).toBeVisible();
    await expect(page.getByText("4 unsaved attendance changes.")).toBeVisible();
    await page.unroute("**/attendance/mark");

    await page.getByRole("button", { name: "Retry save" }).click();
    await expect(page.locator("p[role='status']").filter({ hasText: "Attendance saved for 4 students." })).toBeVisible();
    await expect(page.getByText("4 unsaved attendance changes.")).toBeHidden();
    expect(attempts).toBe(1);

    await page.getByRole("button", { name: /Absent$/ }).first().click();
    let heldRequests = 0;
    let releaseRequest: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/attendance/mark", async (route) => {
      heldRequests += 1;
      await held;
      await route.continue();
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: /Late$/ }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Saving…", exact: true }).click({ force: true }).catch(() => undefined);
    expect(heldRequests).toBe(1);
    releaseRequest?.();
    await expect(page.locator("p[role='status']").filter({ hasText: "Attendance saved for 1 student." })).toBeVisible();
    await page.unroute("**/attendance/mark");
  } finally {
    await admin.api.dispose();
    await admin.context.close();
  }
});

test("teacher sees named, keyboard-operable 44px attendance controls on a narrow viewport", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  let teacherContext: Awaited<ReturnType<typeof loginAsTeacher>>["context"] | undefined;
  try {
    const suffix = uniqueSuffix();
    const academic = await setupAcademicStructure(admin.api, {
      arms: [{ name: "JSS 2 Blue", code: `jss2-blue-${suffix}` }],
    });
    const blueArmId = armId(academic, "JSS 2 Blue");
    await seedAttendanceRoster(admin.api, {
      schoolId: admin.schoolId,
      termId: academic.termId,
      classArmId: blueArmId,
      suffix,
      count: 4,
    });
    const invited = await inviteAndAcceptTeacher(browser, {
      schoolId: admin.schoolId,
      invitedByUserId: admin.ownerUserId,
    });
    await assignTeacher(admin.api, {
      teacherId: invited.userId,
      classArmId: blueArmId,
      subjectId: academic.subjectId,
      academicYearId: academic.academicYearId,
    });
    await setFormTeacher({ schoolId: admin.schoolId, classArmId: blueArmId, teacherId: invited.userId });
    await invited.context.close();

    const teacher = await loginAsTeacher(browser, invited.email, invited.password);
    teacherContext = teacher.context;
    const { page } = teacher;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/teacher/attendance");
    await page.getByLabel("Date").fill(REGISTER_DATE);
    await page.getByRole("button", { name: /Present$/ }).first().waitFor();

    await expect(page.getByLabel("Attendance status key")).toContainText("P Present");
    await expect(page.getByLabel("Attendance status key")).toContainText("E Excused");
    const present = page.getByRole("button", { name: /Present$/ }).first();
    const bounds = await present.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await present.focus();
    await page.keyboard.press("Enter");
    await expect(present).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel(/Note for Oluwaseun Chukwunonso/).first()).toBeVisible();
  } finally {
    await teacherContext?.close();
    await admin.api.dispose();
    await admin.context.close();
  }
});
