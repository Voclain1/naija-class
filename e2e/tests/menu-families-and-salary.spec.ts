import { expect, test } from "@playwright/test";

import { createApiContext, loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";

// 2026-10-19, the owner's list after Phase 9:
//   1. "Too many menu items … group them like a family … easier for a
//      non-technical user": the admin menu folds into sections, the one you
//      are in stays open, and "Find a page" finds a page by an everyday word.
//   5. "When adding or inviting staff, add a salary field and link it with
//      payroll": a salary typed on the invite follows the person into
//      Finance → Payroll.

test("the admin menu is grouped into sections, and finds a page by an everyday word", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  await page.goto("/students");
  const menu = page.locator("aside").getByRole("navigation", { name: "Main menu" });

  // The section holding the page you are on is open; another is closed.
  await expect(menu.getByRole("button", { name: /People/ })).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("link", { name: "Students", exact: true })).toBeVisible();
  const care = menu.getByRole("button", { name: /Student care/ });
  await expect(care).toHaveAttribute("aria-expanded", "false");
  await expect(menu.getByRole("link", { name: "Sickbay", exact: true })).toHaveCount(0);

  // Opening a section shows its pages.
  await care.click();
  await expect(menu.getByRole("link", { name: "Sickbay", exact: true })).toBeVisible();

  // "fees" is not a page name, but it finds Finance.
  await menu.getByLabel("Find a page").fill("fees");
  await menu.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page).toHaveURL(/\/finance\/dashboard/);

  await admin.context.close();
  await admin.api.dispose();
});

test("a salary typed on the invite fills in when the bursar runs payroll", async ({ browser }) => {
  test.setTimeout(4 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  const suffix = uniqueSuffix();
  const email = `pay-${suffix}@example.test`;

  // The invite form, as an owner fills it in.
  await page.goto("/staff/invite");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Role").selectOption("teacher");
  await page.getByLabel("First name (optional)").fill("Ngozi");
  await page.getByLabel("Last name (optional)").fill(`Pay${suffix}`);
  await page.getByLabel("Monthly salary in naira (optional)").fill("185,000");
  await page.getByRole("button", { name: "Send invitation" }).click();
  const acceptUrl = await page.getByLabel("Accept link").inputValue();
  const token = acceptUrl.split("/invitations/")[1]!;

  // The teacher accepts (through the API: the accept page is covered elsewhere).
  const anon = await createApiContext();
  const accepted = await anon.post(`invitations/${token}/accept`, {
    data: { firstName: "Ngozi", lastName: `Pay${suffix}`, password: "Strong-Pass-9", ndprConsent: true },
  });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  const userId = ((await accepted.json()) as { user: { id: string } }).user.id;
  await anon.dispose();

  // The staff page shows the saved salary.
  await page.goto(`/staff/${userId}`);
  await expect(page.getByText("₦185,000.00")).toBeVisible({ timeout: 60_000 });

  // Run payroll: choosing the teacher fills in the gross.
  await page.goto("/finance/payroll");
  await page.getByRole("button", { name: "Run payroll" }).click();
  await page.getByLabel("Staff member").selectOption({ label: `Ngozi Pay${suffix}` });
  await expect(page.getByLabel("Gross salary (₦ naira)")).toHaveValue("185000");
  await expect(page.getByText(/Filled in from their saved salary of ₦185,000\.00/)).toBeVisible();

  await admin.context.close();
  await admin.api.dispose();
});
