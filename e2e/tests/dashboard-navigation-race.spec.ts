import { expect, test, type Route } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure } from "../fixtures/index.js";

// The /dashboard navigation race (docs/deferred-archive.md, captured
// 2026-07-31; fixed 2026-10-10). The topbar's term selector writes the
// school's current term into the URL once two fetches resolve. That write was
// a router.replace() to /dashboard, so a click made before the fetches came
// back was cancelled and the person landed back on the dashboard.
//
// Made deterministic by holding the terms request until AFTER the click has
// navigated, then letting it through: the moment the old code would have
// pulled the page back.
test("a click made before the dashboard picks its term is not undone", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  try {
    await setupAcademicStructure(admin.api);
    const page = admin.page;

    const held: Route[] = [];
    await page.route(/\/academic-years\/[^/]+\/terms(\?.*)?$/, (route) => {
      held.push(route);
    });

    await page.goto("/dashboard");
    await expect.poll(() => held.length, { timeout: 60_000 }).toBeGreaterThan(0);

    await page.getByRole("link", { name: "Students", exact: true }).first().click();
    await page.waitForURL(/\/students(\?.*)?$/);

    // Release the terms response the selector was waiting on, and let the
    // page settle: with the race, this is where it navigated back.
    await page.unroute(/\/academic-years\/[^/]+\/terms(\?.*)?$/);
    const released = page.waitForResponse(/\/academic-years\/[^/]+\/terms/);
    for (const route of held) await route.continue();
    await released;
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/\/students(\?.*)?$/);
    expect(new URL(page.url()).searchParams.has("termId")).toBe(false);
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});

test("left alone, the dashboard still gets its current term in the URL", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  try {
    await setupAcademicStructure(admin.api);
    await admin.page.goto("/dashboard");
    await admin.page.waitForURL(/\/dashboard\?termId=/, { timeout: 60_000 });
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
