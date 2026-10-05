import { expect, test } from "@playwright/test";

import { basePrisma, withTenant } from "@school-kit/db";
import { PLATFORM_AUDIT_VIEW_ACTIONS } from "@school-kit/types";

import { createApiContext, loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";

// Platform-admin tools, slice 1 (docs/modules/platform-admin.md).
//
// Through the real super-admin UI:
//   1. A fresh owner is made a platform admin — the one step done in the
//      database, because that is the only way the grant exists in the product
//      (deliberately: there is no UI that hands out platform access).
//   2. They sign in at /super-admin/login and provision a school.
//   3. The roster shows the school's slug, and "Pending owner".
//   4. Manage → cap the school's AI budget; the row shows it; then back to
//      the platform default.
//   5. Manage → send a new invitation to a corrected address; the first
//      link now reads as expired.
//   6. Manage → cancel the invitation; the roster says "No owner".

test("a platform admin caps a school's AI budget and resends, then cancels, its owner invitation", async ({ browser }) => {
  const operator = await loginAsAdmin(browser);
  await withTenant(operator.schoolId, (db) =>
    db.user.update({ where: { id: operator.ownerUserId }, data: { isPlatformAdmin: true } }),
  );

  const suffix = uniqueSuffix();
  const schoolName = `Tools School ${suffix}`;
  const page = operator.page;
  page.on("dialog", (d) => void d.accept());

  try {
    // ---- 1–2. Sign in to the super-admin surface and provision ---------------
    await page.goto("/super-admin/login");
    await page.getByLabel("Email").fill(operator.email);
    await page.getByLabel("Password").fill(operator.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/super-admin\/dashboard/, { timeout: 60_000 });

    await page.getByLabel("School name").fill(schoolName);
    await page.getByLabel("Owner email").fill(`first-owner-${suffix}@school-kit.test`);
    await page.getByRole("button", { name: "Create & invite" }).click();
    const firstLink = page.getByRole("link", { name: /\/invitations\// });
    await expect(firstLink).toBeVisible({ timeout: 30_000 });
    const firstToken = (await firstLink.textContent())!.split("/invitations/")[1]!;

    // ---- 3. The roster row ----------------------------------------------------
    const row = page.getByRole("row").filter({ hasText: schoolName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    const school = await basePrisma.school.findFirstOrThrow({ where: { name: schoolName }, select: { id: true, slug: true } });
    await expect(row.getByText(school.slug, { exact: true })).toBeVisible();
    await expect(row.getByText("Pending owner")).toBeVisible();
    await expect(row.getByText("2M/mo (default)")).toBeVisible();

    // ---- 4. AI budget ---------------------------------------------------------
    // The dialog hides the page behind it from the accessibility tree, so row
    // checks happen with it closed.
    const dialog = page.getByRole("dialog");
    const openManage = async () => {
      await row.getByRole("button", { name: `Manage ${schoolName}` }).click();
      await expect(dialog).toBeVisible();
    };
    const closeManage = async () => {
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    };
    await openManage();
    await expect(dialog.getByRole("heading", { name: schoolName })).toBeVisible();
    await expect(dialog.getByText("On the platform default:")).toBeVisible();
    await dialog.getByLabel("Tokens a month").fill("750,000");
    await dialog.getByRole("button", { name: "Set cap" }).click();
    await expect(dialog.getByText("Capped at")).toBeVisible();
    expect((await basePrisma.school.findUniqueOrThrow({ where: { id: school.id } })).aiMonthlyTokenBudget).toBe(750_000);
    await page.screenshot({ path: "test-results/platform-admin-tools/1-budget.png" });
    await closeManage();
    await expect(row.getByText("750k/mo")).toBeVisible();

    await openManage();
    await dialog.getByRole("button", { name: "Use platform default" }).click();
    await expect(dialog.getByText("On the platform default:")).toBeVisible();

    // ---- 5. Resend to a corrected address ------------------------------------
    await expect(dialog.getByText("Invitation sent")).toBeVisible();
    await dialog.getByLabel("Send to a different address (optional)").fill(`corrected-owner-${suffix}@school-kit.test`);
    await dialog.getByRole("button", { name: "Send new invitation" }).click();
    const secondLink = dialog.getByRole("link", { name: /\/invitations\// });
    await expect(secondLink).toBeVisible();
    const secondToken = (await secondLink.textContent())!.split("/invitations/")[1]!;
    expect(secondToken).not.toBe(firstToken);
    await page.screenshot({ path: "test-results/platform-admin-tools/2-resent.png" });

    const status = async (token: string) => (await operator.api.get(`invitations/${token}`)).status();
    expect(await status(firstToken)).toBe(410);
    expect(await status(secondToken)).toBe(200);

    // ---- 6. Cancel ------------------------------------------------------------
    await dialog.getByRole("button", { name: "Cancel invitation" }).click();
    await expect(dialog.getByText("No owner", { exact: true })).toBeVisible();
    expect(await status(secondToken)).toBe(410);
    await closeManage();
    await expect(row.getByText("No owner")).toBeVisible();
    await expect(row.getByText("2M/mo (default)")).toBeVisible();
    await page.screenshot({ path: "test-results/platform-admin-tools/3-no-owner.png", fullPage: true });

    const actions = await basePrisma.auditLog.findMany({
      // Changes only: opening the dialog's History records a page view too.
      where: { entityId: school.id, action: { startsWith: "platform_admin.", notIn: [...PLATFORM_AUDIT_VIEW_ACTIONS] } },
      select: { action: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual(
      [
        "platform_admin.owner-invitation.cancel",
        "platform_admin.owner-invitation.resend",
        "platform_admin.schools.create",
        "platform_admin.schools.set-ai-budget",
        "platform_admin.schools.set-ai-budget",
      ].sort(),
    );
  } finally {
    await operator.context.close();
    await operator.api.dispose();
  }
});

// Slice 2 (2026-10-07): suspend a real school, see its owner refused at
// sign-in, reactivate, then delete it by typing its slug.
test("a platform admin suspends a school, reactivates it, then deletes it", async ({ browser }) => {
  const operator = await loginAsAdmin(browser);
  await withTenant(operator.schoolId, (db) =>
    db.user.update({ where: { id: operator.ownerUserId }, data: { isPlatformAdmin: true } }),
  );
  // A separate, ordinary school with a real owner who can sign in.
  const target = await loginAsAdmin(browser);
  const school = await basePrisma.school.findUniqueOrThrow({ where: { id: target.schoolId }, select: { name: true, slug: true } });
  await target.context.close();

  const page = operator.page;
  page.on("dialog", (d) => void d.accept());
  const anon = await createApiContext();
  const ownerLogin = () => anon.post("auth/login", { data: { email: target.email, password: target.password } });

  try {
    await page.goto("/super-admin/login");
    await page.getByLabel("Email").fill(operator.email);
    await page.getByLabel("Password").fill(operator.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/super-admin\/dashboard/, { timeout: 60_000 });

    const row = page.getByRole("row").filter({ hasText: school.slug });
    await expect(row).toBeVisible({ timeout: 30_000 });
    const dialog = page.getByRole("dialog");
    const openManage = async () => {
      await row.getByRole("button", { name: `Manage ${school.name}` }).click();
      await expect(dialog).toBeVisible();
    };
    const closeManage = async () => {
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    };

    // ---- Suspend ------------------------------------------------------------
    await openManage();
    await dialog.getByLabel(/^Reason/).fill("E2E: subscription unpaid");
    await dialog.getByRole("button", { name: "Suspend school" }).click();
    await expect(dialog.getByText("Nobody at this school can sign in.", { exact: false })).toBeVisible();
    // Slice 3: the dialog's History shows it straight away, with who did it.
    const history = dialog.getByRole("list", { name: "School history" });
    await expect(history.getByText("Suspended the school — “E2E: subscription unpaid”")).toBeVisible();
    await page.screenshot({ path: "test-results/platform-admin-tools/4-suspended.png" });
    await closeManage();
    await expect(row.getByText("Suspended")).toBeVisible();

    const refused = await ownerLogin();
    expect(refused.status()).toBe(401);
    expect((await refused.json()).error.code).toBe("SCHOOL_SUSPENDED");

    // ---- Reactivate -----------------------------------------------------------
    await openManage();
    await dialog.getByRole("button", { name: "Reactivate school" }).click();
    await expect(dialog.getByRole("button", { name: "Suspend school" })).toBeVisible();
    await closeManage();
    expect((await ownerLogin()).status()).toBe(200);

    // ---- Delete ---------------------------------------------------------------
    await openManage();
    await dialog.getByRole("button", { name: "Check whether it can be deleted" }).click();
    await expect(dialog.getByText("It cannot be undone.")).toBeVisible();
    const del = dialog.getByRole("button", { name: "Delete school permanently" });
    await expect(del).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill(school.slug);
    await page.screenshot({ path: "test-results/platform-admin-tools/5-delete.png" });
    await del.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row").filter({ hasText: school.slug })).toHaveCount(0);
    expect(await basePrisma.school.findUnique({ where: { id: target.schoolId } })).toBeNull();
    expect((await ownerLogin()).status()).toBe(401);

    // ---- Slice 3: the platform activity log keeps the whole story ------------
    await page.reload();
    const activity = page.getByRole("list", { name: "Platform activity" });
    await expect(activity.getByText("Deleted the school and its 0 students").first()).toBeVisible({ timeout: 30_000 });
    await expect(activity.getByText("Reactivated the school").first()).toBeVisible();
    await expect(activity.getByText("Suspended the school — “E2E: subscription unpaid”").first()).toBeVisible();
    await expect(activity.getByText(school.name).first()).toBeVisible(); // named even after deletion
    await activity.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/platform-admin-tools/6-activity.png" });
  } finally {
    await anon.dispose();
    await operator.context.close();
    await operator.api.dispose();
    await target.api.dispose();
  }
});
