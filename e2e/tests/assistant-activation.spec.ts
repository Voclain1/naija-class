import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { basePrisma, withTenant } from "@school-kit/db";
import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/index.js";

// Controlled activation of the SchoolKit Assistant
// (docs/modules/assistant-workspace.md, "Controlled activation"), through the
// real super-admin console and a real staff session of a SYNTHETIC school:
//
//   1. A newly registered school has no Assistant, and its own owner cannot
//      switch one on (the API refuses).
//   2. The platform admin opens the school's Manage dialog: every row reads
//      "Switch off / Not working".
//   3. They turn on the panel and one task. The rows read "Working"; the
//      school's staff now have the panel.
//   4. They turn on AI understanding while AI is off for the school: the row
//      reads "Switch on" AND "Not working", with the reason in words.
//   5. Rollback: the panel is turned off and staff lose it.
//
// No model is called. Nothing here touches the prompt's approval gate.

const SHOTS = fileURLToPath(new URL("../../docs/reviews/assistant-activation/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });

test("the platform admin, and only the platform admin, switches the Assistant on and off for a school, and sees what is actually working", async ({ browser }) => {
  const operator = await loginAsAdmin(browser);
  await withTenant(operator.schoolId, (db) => db.user.update({ where: { id: operator.ownerUserId }, data: { isPlatformAdmin: true } }));
  const school = await loginAsAdmin(browser); // the synthetic school being activated
  // AI off for this school, so step 4's blocker is the same on any machine.
  await basePrisma.school.update({ where: { id: school.schoolId }, data: { aiEnabled: false } });
  const page = operator.page;
  const staff = school.page;
  page.on("dialog", (d) => void d.accept());
  const assistantButton = staff.getByRole("button", { name: "Open SchoolKit Assistant" });

  try {
    // ---- 1. Off by default; the school cannot switch it on -------------------
    await staff.goto("/dashboard");
    await expect(staff.getByRole("heading").first()).toBeVisible();
    await expect(assistantButton).toHaveCount(0);
    for (const key of ["assistant-workspace", "assistant-model-routing"]) {
      const res = await school.api.patch(`platform-admin/schools/${school.schoolId}/features`, { data: { key, enabled: true } });
      expect(res.status()).toBe(403);
    }
    expect((await school.api.get(`platform-admin/schools/${school.schoolId}/assistant`)).status()).toBe(403);
    expect((await basePrisma.school.findUniqueOrThrow({ where: { id: school.schoolId }, select: { featureSwitches: true } })).featureSwitches).toEqual({});

    // ---- 2. The platform admin's view -----------------------------------------
    await page.goto("/super-admin/login");
    await page.getByLabel("Email").fill(operator.email);
    await page.getByLabel("Password").fill(operator.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/super-admin\/dashboard/, { timeout: 60_000 });
    await page.getByRole("link", { name: "Schools" }).first().click();
    await expect(page).toHaveURL(/\/super-admin\/dashboard\/schools/);
    const row = page.getByRole("row").filter({ hasText: school.schoolName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: `Manage ${school.schoolName}` }).click();
    const dialog = page.getByRole("dialog");
    const section = dialog.getByRole("region", { name: "SchoolKit Assistant" });
    await expect(section).toBeVisible();
    const item = (key: string) => section.getByTestId(`assistant-row-${key}`);
    const KEYS = ["assistant-workspace", "assistant-billing", "reminder-campaigns", "student-intake", "student-corrections", "assistant-model-routing"];
    for (const key of KEYS) {
      await expect(item(key).getByText("Switch off", { exact: true })).toBeVisible();
      await expect(item(key).getByText("Not working", { exact: true })).toBeVisible();
    }
    await expect(item("student-intake").getByText("The Assistant panel is not working for this school, so staff cannot reach it.")).toBeVisible();
    // The Assistant's switches are not repeated in the generic pilot list.
    await expect(dialog.getByRole("region", { name: "Pilot features" }).getByRole("listitem")).toHaveCount(1);

    // ---- 3. Panel and one task on ---------------------------------------------
    await item("assistant-workspace").getByRole("button", { name: `Turn on Assistant panel for ${school.schoolName}` }).click();
    await expect(item("assistant-workspace").getByText("Working", { exact: true })).toBeVisible();
    await item("student-intake").getByRole("button", { name: `Turn on Add and enrol students for ${school.schoolName}` }).click();
    await expect(item("student-intake").getByText("Working", { exact: true })).toBeVisible();
    await expect(item("assistant-billing").getByText("Not working", { exact: true })).toBeVisible();
    await expect(item("assistant-billing").getByText("Its switch is off for this school.")).toBeVisible();

    await staff.reload();
    await assistantButton.click();
    const panel = staff.getByRole("dialog", { name: "SchoolKit Assistant" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("navigation", { name: "Suggested tasks" }).getByRole("button", { name: "Add and enrol students" })).toBeEnabled();

    // ---- 4. AI understanding: switch on, still not working, and it says why ----
    await item("assistant-model-routing").getByRole("button", { name: `Turn on AI understanding for ${school.schoolName}` }).click();
    await expect(item("assistant-model-routing").getByText("Switch on", { exact: true })).toBeVisible();
    await expect(item("assistant-model-routing").getByText("Not working", { exact: true })).toBeVisible();
    await expect(item("assistant-model-routing").getByText("AI is off for this school.")).toBeVisible();
    await expect(item("assistant-model-routing").getByText("Working", { exact: true })).toHaveCount(0);
    await expect(section.getByTestId("assistant-ai-facts")).toContainText("AI for this school: off");
    await expect(section.getByTestId("assistant-ai-facts")).toContainText("approval of the AI prompt: not recorded");
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}console-status.png` });
    await item("assistant-model-routing").getByRole("button", { name: `Turn off AI understanding for ${school.schoolName}` }).click();
    await expect(item("assistant-model-routing").getByText("Switch off", { exact: true })).toBeVisible();

    // ---- 5. Rollback ------------------------------------------------------------
    await item("assistant-workspace").getByRole("button", { name: `Turn off Assistant panel for ${school.schoolName}` }).click();
    await expect(item("assistant-workspace").getByText("Not working", { exact: true })).toBeVisible();
    // The task's own switch is still on, and the row says why it is not working.
    await expect(item("student-intake").getByText("Switch on", { exact: true })).toBeVisible();
    await expect(item("student-intake").getByText("Not working", { exact: true })).toBeVisible();
    await staff.reload();
    await expect(staff.getByRole("heading").first()).toBeVisible();
    await expect(assistantButton).toHaveCount(0);

    // Every change above is in the audit log, by the platform admin.
    const audits = await basePrisma.auditLog.findMany({
      where: { action: "platform_admin.schools.set-feature", entityId: school.schoolId },
      select: { userId: true },
    });
    expect(audits).toHaveLength(5);
    expect(audits.every((a) => a.userId === operator.ownerUserId)).toBe(true);
  } finally {
    await operator.context.close();
    await school.context.close();
  }
});
