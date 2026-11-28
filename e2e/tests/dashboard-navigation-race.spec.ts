import { expect, test, type Page, type Route } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, openFromMenu } from "../fixtures/index.js";

// Lets the page run whatever the released terms response sets in motion (React
// commits, effects, the selector's router.replace in the old code), then returns.
// Deliberately NOT page.waitForLoadState("networkidle"): that waits for every
// connection in the page to go quiet, and this app always has unrelated ones in
// flight (next/image optimiser requests for the logo, RSC prefetches). In CI run
// 46070650528 two optimiser requests never completed, networkidle never fired,
// and, with no action timeout configured, both tests sat until the 180 s test
// timeout and then failed in context.close(). The trace showed the last call was
// "Wait for load state". What matters here is a bounded, deterministic settle.
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => (++frames >= 10 ? resolve() : requestAnimationFrame(tick));
        tick();
      }),
  );
  await page.waitForTimeout(500);
}

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
    await openFromMenu(page, "Students");
    releasing = true;
    const released = page.waitForResponse(/\/academic-years\/[^/]+\/terms/);
    for (const route of held) await route.continue();
    await released;
    // Bounded, so the race fails as "stayed on /dashboard", not as a test timeout.
    await page.waitForURL(/\/students(\?.*)?$/, { timeout: 45_000 });
    await settle(page);

    await expect(page).toHaveURL(/\/students(\?.*)?$/);
    expect(new URL(page.url()).searchParams.has("termId")).toBe(false);
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});

// The same race through a navigation started from code: the command palette
// calls router.push(), which the selector cannot see as a link click, so the
// palette announces it (lib/navigation-intent).
test("a command-palette jump made before the dashboard picks its term is not undone", async ({ browser }) => {
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

    await page.getByRole("button", { name: "Search or run a command" }).click();
    await page.getByPlaceholder("Search or run a command…").fill("Students");
    await page.getByPlaceholder("Search or run a command…").press("Enter");
    releasing = true;
    const released = page.waitForResponse(/\/academic-years\/[^/]+\/terms/);
    for (const route of held) await route.continue();
    await released;
    await page.waitForURL(/\/students(\?.*)?$/, { timeout: 45_000 });
    await settle(page);

    await expect(page).toHaveURL(/\/students(\?.*)?$/);
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
    await expect(admin.page.locator(".dashboard-welcome h1")).toBeVisible();
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
