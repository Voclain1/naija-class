import { expect, test } from "@playwright/test";

import { basePrisma, withTenant } from "@school-kit/db";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";

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
      where: { entityId: school.id, action: { startsWith: "platform_admin." } },
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
