import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/session";

// The first-login tour walks the menu (components/tour/first-login-tour.tsx).
// It broke once in a way no unit test sees (2026-10-12): the card sat along
// the bottom of a phone over the lower menu items, Settings among them, and a
// laptop pointed at items below the fold. This walks every stop on both
// screens and checks what a person sees: the item is on screen, and the card
// is on screen and NOT covering it.

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const inside = (b: Box, vw: number, vh: number) => b.x >= 0 && b.y >= 0 && b.x + b.width <= vw && b.y + b.height <= vh;

async function walkTour(page: Page) {
  const viewport = page.viewportSize()!;
  await page.goto("/settings/school");
  await page.getByRole("button", { name: "Replay tour" }).click();

  const stepText = page.getByText(/^Step \d+ of \d+$/);
  await expect(stepText).toBeVisible();
  const total = Number((await stepText.textContent())!.match(/of (\d+)/)![1]);
  let spots = 0;

  for (let i = 1; i <= total; i++) {
    await expect(page.getByText(`Step ${i} of ${total}`, { exact: true })).toBeVisible();
    const card = page.locator("[data-tour-for]");
    if ((await card.count()) > 0) {
      spots++;
      const target = (await card.getAttribute("data-tour-for"))!;
      const item = page.locator(`[data-tour-target="${target}"]:visible`).first();
      // Wait for the smooth scroll to bring the item fully on screen, and for
      // the card to settle beside it.
      await expect
        .poll(async () => {
          const t = await item.boundingBox();
          const c = await card.boundingBox();
          return Boolean(t && c && inside(t, viewport.width, viewport.height) && !overlaps(t, c));
        }, { message: `stop ${i} (${target}): item on screen and not covered by the card` })
        .toBe(true);
      const c = (await card.boundingBox())!;
      expect(inside(c, viewport.width, viewport.height), `stop ${i} (${target}): card on screen`).toBe(true);
    }
    await page.getByRole("button", { name: i === total ? "Finish" : "Next", exact: true }).click();
  }

  await expect(stepText).toHaveCount(0);
  return spots;
}

test.describe("first-login tour", () => {
  test("laptop: every stop shows its menu item, with the card beside it", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    try {
      await admin.page.setViewportSize({ width: 1366, height: 768 });
      expect(await walkTour(admin.page)).toBeGreaterThanOrEqual(10);
    } finally {
      await admin.context.close();
      await admin.api.dispose();
    }
  });

  test("phone: every stop shows its menu item, with the card above or below it", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    try {
      await admin.page.setViewportSize({ width: 390, height: 844 });
      expect(await walkTour(admin.page)).toBeGreaterThanOrEqual(10);
    } finally {
      await admin.context.close();
      await admin.api.dispose();
    }
  });
});
