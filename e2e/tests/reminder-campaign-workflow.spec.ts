import { basePrisma, withTenant } from "@school-kit/db";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { setupFinanceScaffold } from "../fixtures/finance.js";

async function setup(browser: Browser, durable = false) {
  const admin = await loginAsAdmin(browser); const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "Reminder Class", code: `rem-${suffix}`.slice(0, 20) }] });
  const finance = await setupFinanceScaffold(admin.api, { suffix, ...structure, classArmId: structure.arms[0]!.id });
  const generated = await admin.api.post("invoices/arm/generate", { data: { termId: structure.termId, classArmId: structure.arms[0]!.id } }); expect(generated.ok()).toBe(true);
  if (durable) {
    await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: { "reminder-campaigns": true } } });
    expect((await admin.api.put("notification-preferences", { data: { emailEnabled: false, smsEnabled: false, pushEnabled: true } })).ok()).toBe(true);
    expect((await admin.api.post(`students/${finance.students[0]!.id}/guardians/new`, { data: { firstName: "Test", lastName: "Guardian", relationship: "MOTHER", phone: "+2348000000000", isPrimary: true } })).ok()).toBe(true);
  }
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


test("saved campaigns recover a lost confirmation and reopen without preparing again", async ({ browser }) => {
  const { admin, page } = await setup(browser, true);
  try {
    let prepares = 0, confirms = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/reminder-campaigns/proposals")) prepares++; });
    await page.route("**/reminder-campaigns/proposals/*/confirm", async (route) => { confirms++; const r = await route.fetch(); expect(r.ok()).toBe(true); await route.abort("failed"); });
    await page.getByRole("button", { name: "Select matching students", exact: true }).click();
    await page.getByRole("button", { name: "Review reminder run", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review saved reminder preview" })).toBeVisible();
    await expect(page).toHaveURL(/reminders\/proposals\/[^/]+$/);
    await expect(page.getByRole("button", { name: "Confirm campaign", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: /I checked the term, exclusions/ }).check();
    await page.getByRole("button", { name: "Confirm campaign", exact: true }).click();
    await expect(page).toHaveURL(/reminders\/runs\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Saved reminder campaign" })).toBeVisible();
    expect(prepares).toBe(1); expect(confirms).toBe(1);
    const url = page.url();
    await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: {} } });
    await page.reload(); await expect(page.getByRole("heading", { name: "Saved reminder campaign" })).toBeVisible();
    expect(page.url()).toBe(url); expect(prepares).toBe(1);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("server campaign preview requires a refresh after channel settings change", async ({ browser }) => {
  const { admin, page } = await setup(browser, true);
  try {
    await page.getByRole("button", { name: "Select matching students", exact: true }).click();
    await page.getByRole("button", { name: "Review reminder run", exact: true }).click();
    await expect(page).toHaveURL(/reminders\/proposals\/[^/]+$/);
    await expect(page.getByRole("checkbox", { name: /I checked the term, exclusions/ })).toBeVisible();
    expect((await admin.api.put("notification-preferences", { data: { emailEnabled: false, smsEnabled: false, pushEnabled: false } })).ok()).toBe(true);
    await page.getByRole("checkbox", { name: /I checked the term, exclusions/ }).check(); await page.getByRole("button", { name: "Confirm campaign", exact: true }).click();
    await page.getByRole("button", { name: "Refresh saved preview" }).click();
    await expect(page.getByRole("checkbox", { name: /I checked the term, exclusions/ })).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Confirm campaign", exact: true })).toBeDisabled();
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("a saved journal displays unknown sends without offering to retry them", async ({ browser }, testInfo) => {
  const { admin, page } = await setup(browser, true);
  try {
    await page.getByRole("button", { name: "Select matching students", exact: true }).click(); await page.getByRole("button", { name: "Review reminder run", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /I checked the term, exclusions/ })).toBeVisible();
    await page.getByRole("checkbox", { name: /I checked the term, exclusions/ }).check(); await page.getByRole("button", { name: "Confirm campaign", exact: true }).click();
    await expect(page).toHaveURL(/reminders\/runs\/[^/]+$/);
    const campaignId = new URL(page.url()).pathname.split("/").pop()!;
    await admin.api.post(`finance/reminder-campaigns/${campaignId}/halt`, { data: {} });
    await expect.poll(async () => (await (await admin.api.get(`finance/reminder-campaigns/${campaignId}`)).json()).counts.SENDING).toBe(0);
    // Synthetic provider-journal state only; worker/crash semantics are covered
    // by the backend suite. All status reads below use the real tenant API.
    await withTenant(admin.schoolId, async (db) => {
      await db.$executeRaw`UPDATE reminder_campaigns SET status='HALTED', halt_reason='HALTED_BY_REQUESTER' WHERE school_id=${admin.schoolId} AND id=${campaignId}`;
      await db.$executeRaw`UPDATE reminder_campaign_sends SET status='UNKNOWN', reason='PROVIDER_NO_ANSWER', finished_at=CURRENT_TIMESTAMP WHERE school_id=${admin.schoolId} AND campaign_id=${campaignId}`;
    });
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Unknown sends are never retried" })).toBeVisible();
    await expect(page.getByRole("button", { name: /retry.*send/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Resume unattempted sends" })).toBeDisabled();
    await testInfo.attach("durable-campaign-phone", { body: await page.screenshot(), contentType: "image/png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});
