import { expect, test } from "@playwright/test";

import { armId, loginAsAdmin, openFromMenu, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";

// The school store (2026-10-19, docs/modules/id-cards-and-store.md §4), in a
// real browser against a throwaway school: an item with sizes is added from
// the menu, stock is received, one size is sold to a child and lands on the
// child's charges, a stock take is counted, submitted and approved, and an
// asset goes on the register.

test("add an item, receive and sell stock, approve a stock take, and register an asset", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: `JSS 1 Store ${suffix}`, code: `st${suffix}`.slice(0, 20) }] });
  const student = await apiCreateStudent(admin.api, {
    admissionNumber: `STO/${suffix}`,
    firstName: "Emeka",
    lastName: `Store${suffix}`,
    dateOfBirth: "2013-02-11T00:00:00.000Z",
    gender: "MALE",
  });
  await apiCreateEnrollment(admin.api, {
    studentId: student.id,
    termId: structure.termId,
    classArmId: armId(structure, `JSS 1 Store ${suffix}`),
  });
  const itemName = `School sweater ${suffix}`;

  // 1. An item with two sizes, from the Facilities menu.
  await page.goto("/dashboard");
  await openFromMenu(page, "Store");
  await expect(page).toHaveURL(/\/store$/);
  await page.getByRole("button", { name: "Add item" }).first().click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Name").fill(itemName);
  await add.getByLabel("Reorder when down to").fill("18");
  await add.getByLabel("Selling price in naira (optional)").fill("4,500");
  await add.getByLabel("Sizes (optional)").fill("Size 8, Size 10");
  await add.getByRole("button", { name: "Add item" }).click();
  await expect(page).toHaveURL(/\/store\/items\//, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: itemName })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Size 10" })).toBeVisible();

  // 2. Twenty Size 10 arrive.
  await page.getByRole("button", { name: "Receive stock" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Size").selectOption({ label: "Size 10 (0 in stock)" });
  await dialog.getByLabel(/How many/).fill("20");
  await dialog.getByLabel("Cost of one, in naira (optional)").fill("3,000");
  await dialog.getByRole("button", { name: "Receive" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("row", { name: /Size 10\s+20/ })).toBeVisible();

  // 3. Two sold to Emeka: the amount goes on his bill.
  await page.getByRole("button", { name: "Sell to a student" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Size").selectOption({ label: "Size 10 (20 in stock)" });
  await dialog.getByLabel(/How many/).fill("2");
  await dialog.getByLabel("Student").fill(`STO/${suffix}`);
  await dialog.getByRole("option", { name: new RegExp(`Emeka Store${suffix}`) }).click();
  await dialog.getByRole("button", { name: "Sell and bill" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("row", { name: /Size 10\s+18/ })).toBeVisible();
  // At 18 it is down to the reorder level: low.
  await page.goto("/store?low=true");
  await expect(page.getByRole("row", { name: new RegExp(itemName) }).getByText("Low")).toBeVisible({ timeout: 30_000 });

  const charges = await admin.api.get(`student-charges?studentId=${student.id}`);
  expect(charges.ok()).toBe(true);
  const rows = (await charges.json()) as { kind: string; amount: number; description: string }[];
  expect(rows).toEqual([expect.objectContaining({ kind: "STORE", amount: 900_000, description: `${itemName} (Size 10) × 2` })]);

  // 4. A stock take finds one sweater missing; approving adjusts the stock.
  await page.goto("/store/stock-takes");
  await page.getByRole("button", { name: "Start a stock take" }).click();
  await expect(page).toHaveURL(/\/store\/stock-takes\/[0-9a-f-]+$/, { timeout: 30_000 });
  await page.getByLabel(`Count of ${itemName} Size 10`).fill("17");
  await page.getByLabel(`Count of ${itemName} Size 8`).fill("0");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Submitted for approval.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/1 line differs from the records/)).toBeVisible();
  await page.getByRole("button", { name: "Approve and adjust stock" }).click();
  await expect(page.getByText("Approved. The stock now matches the count.")).toBeVisible({ timeout: 30_000 });
  await page.goto("/store");
  await page.getByRole("link", { name: itemName }).click();
  await expect(page.getByRole("row", { name: /Size 10\s+17/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Stock-take adjustment").first()).toBeVisible();

  // 5. A projector goes on the asset register.
  await page.goto("/store/assets");
  await page.getByRole("button", { name: "Add asset" }).first().click();
  const asset = page.getByRole("dialog");
  await asset.getByLabel("Tag number").fill(`AST-${suffix}`.slice(0, 30));
  await asset.getByLabel("What it is").fill("Epson projector");
  await asset.getByLabel("Where it is").fill("ICT room");
  await asset.getByLabel("Cost in naira (optional)").fill("350,000");
  await asset.getByRole("button", { name: "Add asset" }).click();
  await expect(page).toHaveURL(/\/store\/assets\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Epson projector" })).toBeVisible();
  await expect(page.getByText("ICT room").first()).toBeVisible();
  const assetUrl = page.url();

  // 6. Every Store page fits a 360px phone: no sideways scrolling of the page
  // itself (wide tables scroll inside their own box).
  const itemUrl = await (async () => {
    await page.goto("/store");
    await page.getByRole("link", { name: itemName }).click();
    await expect(page.getByRole("heading", { name: itemName })).toBeVisible({ timeout: 30_000 });
    return page.url();
  })();
  await page.setViewportSize({ width: 360, height: 800 });
  for (const url of ["/store", itemUrl, "/store/stock-takes", "/store/reports", "/store/assets", assetUrl]) {
    await page.goto(url);
    await expect(page.locator("main h1").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll, `${url} scrolls sideways at 360px`).toBeLessThanOrEqual(client + 1);
  }
});
