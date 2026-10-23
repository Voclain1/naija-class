import { expect, test } from "@playwright/test";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian } from "../fixtures/guardian.js";

// Schools work from their own address (docs/modules/school-hosted-apps.md):
// parents at <code>.<domain>/parents, staff at <code>.<domain>/staff. In
// development the domain is localhost:3002 (the portal), so a school's address
// is http://<code>.localhost:3002, which browsers resolve to this machine.

const DOMAIN = process.env.SCHOOL_ADDRESS_DOMAIN || "localhost:3002";
const at = (code: string, path = "/") => `http://${code}.${DOMAIN}${path}`;

async function schoolSlug(api: Awaited<ReturnType<typeof loginAsAdmin>>["api"]): Promise<{ slug: string; name: string }> {
  const me = await api.get("schools/me");
  expect(me.ok(), await me.text()).toBe(true);
  return (await me.json()) as { slug: string; name: string };
}

test("a parent signs in at the school's own address and stays there", async ({ browser }) => {
  test.setTimeout(4 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const school = await schoolSlug(admin.api);
  const guardian = await createPortalGuardian(admin.api, { suffix: uniqueSuffix(), schoolId: admin.schoolId });

  const visitor = await browser.newContext();
  try {
    const page = await visitor.newPage();
    await page.goto(at(school.slug));
    await page.getByRole("link", { name: /Parents/ }).click();
    await expect(page).toHaveURL(at(school.slug, "/parents/login"), { timeout: 60_000 });
    await expect(page.getByTestId("school-sign-in-heading")).toContainText(school.name, { timeout: 30_000 });

    await page.getByLabel("Email").fill(guardian.email);
    await page.getByLabel("Password", { exact: true }).fill(guardian.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(at(school.slug, "/parents"), { timeout: 60_000 });

    // The child's page, and back home, without leaving the school's address.
    await page.getByRole("link", { name: new RegExp(guardian.studentFirstName) }).first().click();
    await expect(page).toHaveURL(new RegExp(`^${at(school.slug, "/parents/students/")}[0-9a-f-]{36}$`), { timeout: 60_000 });
    await page.getByRole("link", { name: /Back|Your children/ }).first().click();
    await expect(page).toHaveURL(at(school.slug, "/parents"), { timeout: 60_000 });

    // The front page is still the front page.
    await page.goto(at(school.slug));
    await expect(page.getByRole("heading", { level: 1, name: school.name })).toBeVisible({ timeout: 60_000 });
  } finally {
    await visitor.close();
  }
});

test("another school's address refuses a parent and a member of staff like a wrong password", async ({ browser }) => {
  test.setTimeout(4 * 60 * 1000);
  const mine = await loginAsAdmin(browser);
  const other = await loginAsAdmin(browser);
  const otherSchool = await schoolSlug(other.api);
  const guardian = await createPortalGuardian(mine.api, { suffix: uniqueSuffix(), schoolId: mine.schoolId });

  const visitor = await browser.newContext();
  try {
    const page = await visitor.newPage();
    await page.goto(at(otherSchool.slug, "/parents/login"));
    await page.getByLabel("Email").fill(guardian.email);
    await page.getByLabel("Password", { exact: true }).fill(guardian.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible({ timeout: 30_000 });

    // Staff sign-in at a school's address: no new-school sign-up, and only
    // that school's accounts.
    await page.goto(at(otherSchool.slug, "/staff/login"));
    await expect(page.getByTestId("school-sign-in-heading")).toContainText(otherSchool.name, { timeout: 60_000 });
    await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
    await page.getByLabel("Email").fill(mine.email);
    await page.getByLabel("Password", { exact: true }).fill(mine.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(at(otherSchool.slug, "/staff/login"));
  } finally {
    await visitor.close();
  }
});

test("the staff app's older addresses still lead to the same page under /staff", async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  await admin.page.goto("/settings/school");
  await expect(admin.page).toHaveURL(/\/staff\/settings\/school$/, { timeout: 60_000 });
  await expect(admin.page.getByRole("button", { name: "Change address" })).toBeVisible({ timeout: 60_000 });
});
