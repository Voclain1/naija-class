import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";

// The store's price list for parents (2026-10-19): a priced item shows on the
// portal by size, available or out of stock; the owner's switch hides it.

test("a parent sees the store's prices, and nothing once the school switches them off", async ({ browser }) => {
  test.setTimeout(4 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  await setupAcademicStructure(admin.api, { arms: [{ name: `JSS 1 Shop ${suffix}`, code: `sh${suffix}`.slice(0, 20) }] });
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const name = `School tie ${suffix}`;

  const created = await admin.api.post("store/items", {
    data: { name, category: "UNIFORM", unit: "piece", reorderLevel: 0, sellPrice: 250_000, variants: ["Junior", "Senior"] },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const item = (await created.json()) as { variants: { id: string; label: string }[] };
  const junior = item.variants.find((v) => v.label === "Junior")!;
  const received = await admin.api.post("store/movements", { data: { kind: "RECEIVE", variantId: junior.id, quantity: 10 } });
  expect(received.ok(), await received.text()).toBe(true);

  const parentContext = await browser.newContext();
  try {
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.getByRole("link", { name: "School store prices →" }).click();

    const card = parent.getByRole("region", { name });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("listitem").filter({ hasText: "Junior" })).toContainText("Available");
    await expect(card.getByRole("listitem").filter({ hasText: "Senior" })).toContainText("Out of stock");
    await expect(card).toContainText("₦2,500.00");

    // The owner switches it off on the Store page.
    await admin.page.goto("/store");
    const toggle = admin.page.getByRole("switch", { name: "Show parents the price list" });
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await parent.reload();
    await expect(parent.getByText("The school has not shared its store prices.")).toBeVisible({ timeout: 30_000 });
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
