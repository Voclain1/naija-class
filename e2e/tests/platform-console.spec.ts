import { expect, test } from "@playwright/test";

import { basePrisma, withTenant } from "@school-kit/db";

import { loginAsAdmin } from "../fixtures/index.js";

// The platform admin console (2026-10-30 redesign, docs/modules/platform-admin.md)
// and Getting started (docs/modules/activation.md), through the real UI:
//   1. Overview shows the figures and the "Needs you" list.
//   2. Getting started finds a stuck school, with its stage, its owner's
//      contacts and WhatsApp link, and its reminder (clicked).
//   3. Every page in the side menu opens.
//   4. On a phone the menu folds into the top bar.

const DAY = 24 * 60 * 60 * 1000;

test("the platform admin console shows a stuck school with its owner and reminders", async ({ browser }) => {
  test.setTimeout(420_000);
  const operator = await loginAsAdmin(browser);
  await withTenant(operator.schoolId, (db) => db.user.update({ where: { id: operator.ownerUserId }, data: { isPlatformAdmin: true } }));

  // A school that signed up ten days ago and has added nobody: stuck at "Set up".
  const stuck = await loginAsAdmin(browser);
  await stuck.context.close();
  const school = await basePrisma.school.update({
    where: { id: stuck.schoolId },
    data: { createdAt: new Date(Date.now() - 10 * DAY) },
    select: { name: true, slug: true },
  });
  await withTenant(stuck.schoolId, (db) =>
    db.activationEmail.create({
      data: { schoolId: stuck.schoolId, kind: "FIRST", toEmail: stuck.email, stageAtSend: 2, status: "DELIVERED", clickCount: 1, firstClickedAt: new Date() },
    }),
  );

  const page = operator.page;
  try {
    await page.goto("/super-admin/login");
    await page.getByLabel("Email").fill(operator.email);
    await page.getByLabel("Password").fill(operator.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/super-admin\/dashboard$/, { timeout: 60_000 });

    // ---- 1. Overview -----------------------------------------------------------
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Schools stuck in setup/ })).toBeVisible();
    await page.screenshot({ path: "test-results/platform-console/1-overview.png", fullPage: true });

    // ---- 2. Getting started ----------------------------------------------------
    await page.getByRole("link", { name: "Getting started" }).first().click();
    await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
    // The API keeps the list for five minutes; this school was changed just now.
    const refresh = page.getByRole("button", { name: "Refresh" });
    await expect(refresh).toBeVisible({ timeout: 120_000 });
    await refresh.click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible({ timeout: 120_000 });
    await page.getByLabel("Search").fill(school.slug);
    const row = page.getByRole("listitem").filter({ hasText: school.slug });
    await expect(row).toBeVisible({ timeout: 90_000 });
    await expect(row.getByText("Stuck", { exact: true })).toBeVisible();
    await expect(row.getByText("2. Set up")).toBeVisible();
    await expect(row.getByText("1st reminder: clicked")).toBeVisible();
    await expect(row.getByRole("link", { name: stuck.email })).toHaveAttribute("href", `mailto:${stuck.email}`);
    await expect(row.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+\?text=/);
    await page.screenshot({ path: "test-results/platform-console/2-getting-started.png", fullPage: true });

    // ---- 3. Every page opens ----------------------------------------------------
    for (const [link, heading] of [
      ["Schools", "Schools"],
      ["Requests", "Requests"],
      ["Smart Import beta", "Smart Import beta"],
      ["People", "People"],
      ["Activity", "Activity"],
    ] as const) {
      await page.getByRole("link", { name: link, exact: true }).first().click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    await page.goto("/super-admin/dashboard/schools");
    await expect(page.getByRole("row").filter({ hasText: school.slug })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "test-results/platform-console/3-schools.png" });

    // ---- 4. On a phone ------------------------------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/super-admin/dashboard");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: "Getting started" }).click();
    await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scroll).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/platform-console/4-phone.png" });
  } finally {
    await withTenant(stuck.schoolId, (db) => db.activationEmail.deleteMany({})).catch(() => undefined);
    await operator.context.close();
    await operator.api.dispose();
    await stuck.api.dispose();
  }
});
