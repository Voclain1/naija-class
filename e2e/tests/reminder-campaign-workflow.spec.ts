import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { setupFinanceScaffold } from "../fixtures/finance.js";

async function setup(browser: Browser) {
  const admin = await loginAsAdmin(browser); const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "Reminder Class", code: `rem-${suffix}`.slice(0, 20) }] });
  const finance = await setupFinanceScaffold(admin.api, { suffix, ...structure, classArmId: structure.arms[0]!.id });
  const generated = await admin.api.post("invoices/arm/generate", { data: { termId: structure.termId, classArmId: structure.arms[0]!.id } }); expect(generated.ok()).toBe(true);
  await admin.page.goto("/finance/reminders");
  await expect(admin.page.getByRole("heading", { name: "Follow up with the right families." })).toBeVisible();
  await expect(admin.page.getByLabel("Term", { exact: true })).toHaveValue(structure.termId);
  // Fixture invoices are issued without an overdue transition. Do not invent a
  // client-side due-date rule: explicitly include the current issued invoices.
  await admin.page.getByRole("checkbox", { name: "Overdue invoices only" }).uncheck();
  await expect(admin.page.getByText("3 matching students · 0 selected", { exact: true })).toBeVisible();
  return { admin, structure, finance, page: admin.page };
}
async function reviewAll(page: Page) {
  await page.getByRole("button", { name: "Select matching students", exact: true }).click();
  await page.getByRole("button", { name: "Review reminder run", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.getByRole("heading", { name: "Review fee reminders" })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /I checked the term/ })).toBeVisible(); return dialog;
}

test("fee reminders are reviewed before sending and show the real API's no-guardian results", async ({ browser }, testInfo) => {
  const { admin, page } = await setup(browser);
  try {
    let sends = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/finance/debtors/remind")) sends++; });
    const dialog = await reviewAll(page);
    await expect(dialog.getByText("Adaeze Okonkwo", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Confirm and send reminders" })).toBeDisabled(); expect(sends).toBe(0);
    await testInfo.attach("reminder-review", { body: await page.screenshot(), contentType: "image/png" });
    await dialog.getByRole("button", { name: "Back to selection" }).click(); expect(sends).toBe(0);
    await expect(page.getByText("3 matching students · 0 selected", { exact: true })).toBeVisible();
    await reviewAll(page); await dialog.getByRole("checkbox", { name: /I checked the term/ }).check();
    await dialog.getByRole("button", { name: "Confirm and send reminders" }).click();
    await expect(dialog.getByRole("heading", { name: "Reminder run results" })).toBeVisible();
    await expect(dialog.getByText(/3 have no parent or guardian linked/)).toBeVisible(); expect(sends).toBe(1);
    await expect(dialog.getByRole("button", { name: "Confirm and send reminders" })).toHaveCount(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("review rechecks invoices and removes a student whose only invoice was cancelled", async ({ browser }) => {
  const { admin, page, structure } = await setup(browser);
  try {
    await page.getByRole("button", { name: "Select matching students", exact: true }).click();
    const invoices = await (await admin.api.get(`invoices?termId=${structure.termId}`)).json();
    expect((await admin.api.post(`invoices/${invoices.data[0].id}/cancel`, { data: {} })).ok()).toBe(true);
    await page.getByRole("button", { name: "Review reminder run", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("No longer eligible", { exact: true }).locator("..").locator("dd")).toHaveText("1");
    await expect(dialog.getByRole("checkbox", { name: /I checked the term/ })).toBeVisible();
    await expect(dialog.locator("tbody tr")).toHaveCount(2);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("an unconfirmed send stops retries, keeps the warning open, and fits a phone", async ({ browser }, testInfo) => {
  const { admin, page } = await setup(browser);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    let sends = 0;
    await page.route("**/finance/debtors/remind", async (route) => {
      sends++; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed");
    });
    const dialog = await reviewAll(page); await dialog.getByRole("checkbox", { name: /I checked the term/ }).check();
    await dialog.getByRole("button", { name: "Confirm and send reminders" }).click();
    await expect(dialog.getByRole("heading", { name: "Stop: the last send is unconfirmed" })).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText("Some reminders may already have been sent");
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Confirm and send|Retry|Back to selection/ })).toHaveCount(0);
    expect(sends).toBe(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach("reminder-uncertain-phone", { body: await page.screenshot(), contentType: "image/png" });
    page.on("dialog", (d) => void d.accept()); // beforeunload during test teardown
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("all channels off disables confirmation without changing the school's settings", async ({ browser }) => {
  const { admin, page } = await setup(browser);
  try {
    const pref = await admin.api.put("notification-preferences", { data: { emailEnabled: false, smsEnabled: false, pushEnabled: false } }); expect(pref.ok()).toBe(true);
    let sends = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/finance/debtors/remind")) sends++; });
    const dialog = await reviewAll(page); await expect(dialog.getByRole("alert")).toContainText("All channels are off");
    await dialog.getByRole("checkbox", { name: /I checked the term/ }).check(); await expect(dialog.getByRole("button", { name: "Confirm and send reminders" })).toBeDisabled(); expect(sends).toBe(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("frontend reminder controls refuse an account without send permission", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  try {
    // UI gate only: this does not claim to test backend authorization with an
    // owner's unchanged API token. Existing API permission specs cover that.
    await admin.page.route("**/auth/me", async (route) => { const response = await route.fetch(); const me = await response.json(); await route.fulfill({ json: { ...me, permissions: ["finance.debtors.read"], roles: me.roles.map((r: { key: string }) => ({ ...r, key: "bursar" })) } }); });
    await admin.page.goto("/finance/reminders");
    await expect(admin.page.getByRole("heading", { name: "Fee reminders are not available for this account" })).toBeVisible();
    await expect(admin.page.getByRole("button", { name: "Review reminder run" })).toHaveCount(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("the debtor list now reviews selected reminders instead of sending immediately", async ({ browser }) => {
  const { admin, page } = await setup(browser);
  try {
    await page.goto("/finance/debtors");
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
    await page.getByRole("checkbox", { name: "Select all visible students" }).check();
    let sends = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/finance/debtors/remind")) sends++; });
    await page.getByRole("button", { name: "Review reminders (3 students)", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Review fee reminders" })).toBeVisible(); expect(sends).toBe(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});
