import { expect, test } from "@playwright/test";

import { basePrisma } from "@school-kit/db";

import { apiCreateStudent } from "../fixtures/finance.js";
import { loginAsAdmin } from "../fixtures/index.js";

// Plans and student caps (docs/modules/plans.md), through the browser: the
// Settings → Plan route resolves (CLAUDE.md: only the browser catches a
// route-group slip), it says where the school is against its limit, and the
// Students page warns once the school is close to it. During early access
// (PLAN_ENFORCEMENT unset = warn) the notice says nothing is blocked.
test("an admin sees the school's plan, and a notice on Students when close to its limit", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  try {
    const page = admin.page;

    await page.goto("/settings");
    await page.getByRole("link", { name: /^Plan/ }).click();
    await expect(page.getByRole("heading", { name: "Plan", level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Free plan" })).toBeVisible();
    await expect(page.getByText(/of the 100 students its Free plan covers/)).toBeVisible();

    // No notice while there is room.
    await page.goto("/students");
    await expect(page.getByRole("heading", { name: "Students", level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("plan-notice")).toHaveCount(0);

    // One student on the roll against a limit of 1: at the limit, so close.
    await basePrisma.school.update({ where: { id: admin.schoolId }, data: { studentCapOverride: 1 } });
    await apiCreateStudent(admin.api, {
      admissionNumber: `PLAN/${Date.now()}`,
      firstName: "Plan",
      lastName: "Notice",
      dateOfBirth: "2014-01-01T00:00:00.000Z",
      gender: "FEMALE",
    });
    await page.reload();
    const notice = page.getByTestId("plan-notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText("Close to your plan's student limit");
    await expect(notice).toContainText("nothing is blocked");
  } finally {
    await basePrisma.school.update({ where: { id: admin.schoolId }, data: { studentCapOverride: null } }).catch(() => undefined);
    await admin.context.close();
    await admin.api.dispose();
  }
});
