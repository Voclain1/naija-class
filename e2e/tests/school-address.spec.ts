import { expect, test } from "@playwright/test";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";
import { PORTAL_BASE_URL } from "../fixtures/guardian.js";

// School web addresses (docs/modules/school-addresses.md): the owner changes the
// address in Settings → School; the school's front page answers at the new code,
// and the old code still leads there.

test("the owner changes the school's address, and the old one still leads to the school's page", async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const me = await admin.api.get("schools/me");
  expect(me.ok(), await me.text()).toBe(true);
  const school = (await me.json()) as { name: string; slug: string };
  const next = `e2e-addr-${uniqueSuffix()}`.slice(0, 30);

  await admin.page.goto("/settings/school");
  await expect(admin.page.getByText(`${school.slug}.schoolkit.ng`)).toBeVisible({ timeout: 60_000 });
  await admin.page.getByRole("button", { name: "Change address" }).click();
  await admin.page.getByLabel("New address").fill("portal");
  await expect(admin.page.getByText("This address is kept for SchoolKit.")).toBeVisible();
  await admin.page.getByLabel("New address").fill(next);
  await expect(admin.page.getByText("Available.")).toBeVisible({ timeout: 30_000 });
  await admin.page.getByRole("button", { name: "Use this address" }).click();
  await expect(admin.page.getByText(`${next}.schoolkit.ng`, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(admin.page.getByText(`Earlier addresses still work and lead here: ${school.slug}.schoolkit.ng.`)).toBeVisible();

  const visitor = await browser.newContext();
  try {
    const page = await visitor.newPage();
    await page.goto(`${PORTAL_BASE_URL}/school/${school.slug}`);
    await expect(page).toHaveURL(new RegExp(`/school/${next}$`), { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1, name: school.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText(`school code ${next}`)).toBeVisible();
    await expect(page.getByText(`© ${new Date().getFullYear()} SchoolKit`)).toBeVisible();

    // The parent sign-in reached from the page names the school.
    await page.getByRole("link", { name: /Parents/ }).click();
    await expect(page.getByTestId("school-sign-in-heading")).toContainText(school.name, { timeout: 30_000 });
  } finally {
    await visitor.close();
  }
});
