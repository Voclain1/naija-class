import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/index.js";
import { OLD_RULES_PASSWORD, setOldRulesPassword } from "../fixtures/db.js";

// Pre-launch (2026-10-19, docs/runbooks/launch-checklist.md §5): a staff member
// whose password was set under the older Phase 0 rules signs in, is sent to
// choose a new one, and then signs in with it.

test("an old-rules password is replaced at sign-in, then the new one works", async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  await setOldRulesPassword(admin.schoolId, admin.ownerUserId);
  await admin.context.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(OLD_RULES_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/reset-password\/[^/?]+\?why=old-rules/, { timeout: 30_000 });
  await expect(page.getByText("Your password was set before SchoolKit asked for stronger ones.")).toBeVisible();
  // No session was made: the dashboard is still behind sign-in.
  expect((await context.cookies()).some((c) => c.name === "sk_session")).toBe(false);

  const fresh = "Brighter-Day-2026!";
  await page.getByLabel("New password", { exact: true }).fill(fresh);
  await page.getByLabel("Confirm new password").fill(fresh);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Your password has been changed.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/login");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(fresh);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login|\/reset-password/, { timeout: 30_000 });

  await context.close();
  await admin.api.dispose();
});
