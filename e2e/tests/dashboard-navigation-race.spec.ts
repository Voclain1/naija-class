import { expect, test, type Route } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure } from "../fixtures/index.js";

// The /dashboard navigation race (docs/deferred-archive.md, captured
// 2026-07-31; fixed 2026-10-10). The topbar's term selector writes the
// school's current term into the URL once two fetches resolve. That write was
// a router.replace() to /dashboard, so a click made before the fetches came
// back was cancelled and the person landed back on the dashboard.
//
// Made repeatable by holding the terms request until the click has started its
// navigation, then letting it through while that navigation is in flight: the
// moment the old code pulled the page back.
test("a click made before the dashboard picks its term is not undone", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  try {
    await setupAcademicStructure(admin.api);
    const page = admin.page;

    const held: Route[] = [];
    let releasing = false;
    await page.route(/\/academic-years\/[^/]+\/terms(\?.*)?$/, (route) => {
      if (releasing) void route.continue();
      else held.push(route);
    });

    await page.goto("/dashboard");
    await expect.poll(() => held.length, { timeout: 60_000 }).toBeGreaterThan(0);

    // Click, and let the terms response through while that navigation is
    // still in flight: the window in which the old router.replace() cancelled
    // it. Then let everything settle and see where the person ended up.
    await page.getByRole("link", { name: "Students", exact: true }).first().click();
    releasing = true;
    const released = page.waitForResponse(/\/academic-years\/[^/]+\/terms/);
    for (const route of held) await route.continue();
    await released;
    // Bounded, so the race fails as "stayed on /dashboard", not as a test timeout.
    await page.waitForURL(/\/students(\?.*)?$/, { timeout: 45_000 });
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
    // The page must SEE the term, not just the address bar: a URL write that
    // Next does not sync into useSearchParams leaves the dashboard loading.
    await expect(admin.page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
