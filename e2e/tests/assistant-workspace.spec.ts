import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { basePrisma, withTenant } from "@school-kit/db";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { inviteAndAcceptTeacher, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { apiListInvoices, setupFinanceScaffold } from "../fixtures/finance.js";

// The SchoolKit Assistant workspace (docs/modules/assistant-workspace.md),
// end to end against the real API: global access, navigation, desktop and
// phone layouts, and the four reviewed workflows with explicit approval,
// lost-response recovery and stale previews. No model is involved anywhere.

const SHOTS = fileURLToPath(new URL("../../docs/reviews/assistant-workspace/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const ALL_ON = { "assistant-workspace": true, "assistant-billing": true, "reminder-campaigns": true, "student-intake": true, "student-corrections": true };

async function setup(browser: Browser, switches: Record<string, boolean> = ALL_ON, finance = true) {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 2B", code: `a-${suffix}`.slice(0, 20) }] });
  const scaffold = finance ? await setupFinanceScaffold(admin.api, { suffix, ...structure, classArmId: structure.arms[0]!.id }) : null;
  await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: switches } });
  return { admin, structure, scaffold, page: admin.page };
}

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "Open SchoolKit Assistant" }).click();
  const panel = page.getByRole("dialog", { name: "SchoolKit Assistant" });
  await expect(panel).toBeVisible();
  return panel;
}

async function ask(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Describe a task" });
  await box.fill(text);
  await box.press("Enter");
}

test("is reachable across staff pages, keeps the conversation across navigation, and fits desktop and phone", async ({ browser }) => {
  const { admin, page } = await setup(browser, ALL_ON, false);
  try {
    await page.goto("/dashboard");
    let panel = await openAssistant(page);
    await expect(panel.getByText("What do you need done?")).toBeVisible();
    await expect(panel.getByRole("navigation", { name: "Suggested tasks" }).getByRole("button")).toHaveCount(4);
    await ask(page, "How do I add parents?");
    await expect(panel.getByText("From the Getting started guide:")).toBeVisible();
    await ask(page, "delete all students");
    await expect(panel.getByText(/I can't delete anything|I can’t delete anything/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}desktop-conversation.png` });

    // Minimise, navigate across areas, reopen: the conversation is intact.
    await panel.getByRole("button", { name: "Minimise assistant" }).click();
    await expect(page.getByRole("button", { name: "Open SchoolKit Assistant" })).toBeFocused();
    // In-app navigation (the menu's links), as staff move around. A marker on
    // window proves no page load happened in between.
    await page.evaluate(() => { (window as unknown as { __sameDoc: boolean }).__sameDoc = true; });
    const menu = page.locator("aside").getByRole("navigation", { name: "Main menu" });
    await menu.getByLabel("Find a page").fill("students");
    await menu.getByRole("link", { name: "Students", exact: true }).click();
    await expect(page).toHaveURL(/\/students$/);
    panel = await openAssistant(page);
    await expect(panel.getByText("How do I add parents?")).toBeVisible();
    // Students pages put student tasks first (from the path only, not the page's contents).
    await expect(panel.getByRole("navigation", { name: "Suggested tasks" }).getByRole("button").first()).toHaveText("Add and enrol students");
    // Navigating with the panel open keeps it open and intact.
    await menu.getByLabel("Find a page").fill("fees");
    await menu.getByRole("link", { name: "Bursary", exact: true }).click();
    await expect(page).toHaveURL(/\/finance\/dashboard/);
    await expect(panel.getByText("How do I add parents?")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __sameDoc?: boolean }).__sameDoc)).toBe(true);
    // Escape minimises; the page underneath was never left.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    // Nothing the person typed lands in browser storage or the URL.
    const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, u: location.href }));
    expect(stored).not.toMatch(/add parents|delete all students/i);

    // Phone: a full-screen panel with no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    panel = await openAssistant(page);
    const box = await panel.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(389);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${SHOTS}phone-conversation.png` });

    // A reload ends the conversation: it lived only in this page's memory.
    await page.reload();
    panel = await openAssistant(page);
    await expect(panel.getByText("What do you need done?")).toBeVisible();
    await expect(panel.getByText("How do I add parents?")).toHaveCount(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("is hidden when the school's switch is off, and help-only for a teacher", async ({ browser }) => {
  const { admin, page } = await setup(browser, { ...ALL_ON, "assistant-workspace": false }, false);
  try {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open SchoolKit Assistant" })).toHaveCount(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }

  // A second school with the assistant on (the API caches each school's
  // switches for 30 seconds, so the first school is not flipped in place).
  const on = await setup(browser, ALL_ON, false);
  try {
    const teacher = await inviteAndAcceptTeacher(browser, { schoolId: on.admin.schoolId, invitedByUserId: on.admin.ownerUserId });
    try {
      await teacher.page.goto("/teacher/dashboard");
      const panel = await openAssistant(teacher.page);
      await expect(panel.getByRole("navigation", { name: "Suggested tasks" })).toHaveCount(0);
      await ask(teacher.page, "Add new students to JSS 2B");
      await expect(panel.getByText(/permission/)).toBeVisible();
      await expect(panel.getByRole("button", { name: /^Show the server['’]s preview$/ })).toHaveCount(0);
    } finally { await teacher.context.close(); }
  } finally { await on.admin.context.close(); await on.admin.api.dispose(); }
});

test("invoices: request, server preview without writes, explicit approval, and a lost approval recovers the original run", async ({ browser }) => {
  const { admin, page, structure } = await setup(browser);
  try {
    await page.goto("/finance/invoices");
    const panel = await openAssistant(page);
    await ask(page, "Generate invoices for JSS 2B this term");
    const card = panel.getByRole("region", { name: "Term invoices" });
    await expect(card.getByRole("checkbox", { name: /JSS 2B/ })).toBeChecked();
    await card.getByRole("button", { name: /^Show the server['’]s preview$/ }).click();
    await expect(card.getByText("Awaiting your approval")).toBeVisible();
    expect((await apiListInvoices(admin.api, { termId: structure.termId })).total).toBe(0);
    await expect(card.getByRole("button", { name: "Approve and issue invoices" })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}desktop-invoice-preview.png` });

    let approvals = 0;
    await page.route("**/assistant/billing/runs/*/approve", async (route) => {
      approvals += 1;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await card.getByRole("checkbox", { name: /I checked this preview/ }).check();
    await card.getByRole("button", { name: "Approve and issue invoices" }).click();
    await expect(card.getByText(/Done: 3 invoices issued/)).toBeVisible();
    expect(approvals).toBe(1);
    expect((await apiListInvoices(admin.api, { termId: structure.termId })).total).toBe(3);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("reminders: segmented selection, server preview, one confirmation, saved campaign status, halt/resume, UNKNOWN and quiet hours", async ({ browser }) => {
  const { admin, page, structure, scaffold } = await setup(browser);
  try {
    expect((await admin.api.post("invoices/arm/generate", { data: { termId: structure.termId, classArmId: structure.arms[0]!.id } })).ok()).toBe(true);
    expect((await admin.api.put("notification-preferences", { data: { emailEnabled: false, smsEnabled: false, pushEnabled: true } })).ok()).toBe(true);
    expect((await admin.api.post(`students/${scaffold!.students[0]!.id}/guardians/new`, { data: { firstName: "Test", lastName: "Guardian", relationship: "MOTHER", phone: "+2348000000000", isPrimary: true } })).ok()).toBe(true);
    await page.goto("/finance/debtors");
    const panel = await openAssistant(page);
    await ask(page, "Remind parents who owe fees in JSS 2B");
    const card = panel.getByRole("region", { name: "Fee reminders" });
    await expect(card.getByText(/3 matching students · 0 selected/)).toBeVisible();
    await card.getByRole("button", { name: "Select all matching" }).click();
    let prepares = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/finance/reminder-campaigns/proposals")) prepares += 1; });
    await card.getByRole("button", { name: /^Show the server['’]s preview$/ }).click();
    await expect(card.getByText("Awaiting your confirmation")).toBeVisible();
    expect(await withTenant(admin.schoolId, (db) => db.reminderCampaign.count({ where: { schoolId: admin.schoolId } }))).toBe(0);
    await card.getByRole("checkbox", { name: /I checked this preview/ }).check();
    await card.getByRole("button", { name: "Confirm and start sending" }).click();
    const campaign = panel.getByRole("region", { name: "Fee reminder campaign" });
    await expect(campaign).toBeVisible();
    expect(prepares).toBe(1);
    expect(await withTenant(admin.schoolId, (db) => db.reminderCampaign.count({ where: { schoolId: admin.schoolId } }))).toBe(1);
    // Halt and explicit resume act on the saved campaign (when it is still running).
    if (await campaign.getByRole("button", { name: "Halt campaign" }).isVisible()) {
      await campaign.getByRole("button", { name: "Halt campaign" }).click();
      await expect(campaign.getByText("Halted", { exact: true })).toBeVisible();
      await campaign.getByRole("button", { name: /Resume/ }).click();
    }
    // UNKNOWN and quiet hours as the server reports them (provider answers
    // cannot be lost on demand in a browser test; the journal's own tests cover that).
    await page.route("**/finance/reminder-campaigns/*", async (route) => {
      if (route.request().method() !== "GET" || route.request().url().includes("/proposals/")) return route.continue();
      const body = await (await route.fetch()).json();
      body.status = "RUNNING"; body.heldForQuietHours = true; body.counts.UNKNOWN = 1;
      await route.fulfill({ json: body });
    });
    await campaign.getByRole("button", { name: "Refresh status" }).click();
    await expect(campaign.getByText(/may have gone out/)).toBeVisible();
    await expect(campaign.getByText(/Sends wait until 06:00/)).toBeVisible();
    await expect(campaign.getByRole("button", { name: /Retry/ })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}desktop-reminder-campaign.png` });
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("intake: structured rows and placement, preview without writes, lost confirmation recovers the original intake", async ({ browser }) => {
  const { admin, page, structure } = await setup(browser, ALL_ON, false);
  try {
    await page.goto("/students");
    const panel = await openAssistant(page);
    await ask(page, "Add 2 new students to JSS 2B");
    const card = panel.getByRole("region", { name: "Add and enrol students" });
    const fill = async (i: number, first: string, last: string, dob: string, gender: string, adm: string) => {
      await card.getByRole("textbox", { name: `Student ${i} first name` }).fill(first);
      await card.getByRole("textbox", { name: `Student ${i} last name` }).fill(last);
      await card.getByLabel(`Student ${i} date of birth`).fill(dob);
      await card.getByRole("combobox", { name: `Student ${i} gender` }).selectOption(gender);
      await card.getByRole("textbox", { name: `Student ${i} admission number (optional)` }).fill(adm);
    };
    const suffix = uniqueSuffix();
    await fill(1, "Amaka", "Nwosu", "2014-02-03", "FEMALE", `AS-${suffix}-1`);
    await fill(2, "Tunde", "Bello", "2013-11-20", "MALE", `AS-${suffix}-2`);
    await card.getByRole("combobox", { name: "Class" }).selectOption(structure.arms[0]!.id);
    await card.getByRole("combobox", { name: "Term" }).selectOption(structure.termId);
    await card.getByRole("button", { name: /^Show the server['’]s preview$/ }).click();
    await expect(card.getByText("Awaiting your confirmation")).toBeVisible();
    await expect(card.getByText("Amaka Nwosu")).toBeVisible();
    const count = () => withTenant(admin.schoolId, (db) => db.student.count({ where: { schoolId: admin.schoolId } }));
    expect(await count()).toBe(0);
    await page.route("**/student-intake/proposals/*/confirm", async (route) => { await route.fetch(); await route.abort("failed"); });
    await card.getByRole("checkbox", { name: /I checked these 2 students/ }).check();
    await card.getByRole("button", { name: "Confirm and save students" }).click();
    await expect(panel.getByText(/Saved 2 students, 2 placed in their class/)).toBeVisible();
    expect(await count()).toBe(2);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("corrections: find by roster search, explicit clear, server before/after, stale preview needs a fresh review", async ({ browser }) => {
  const { admin, page, scaffold } = await setup(browser, ALL_ON);
  try {
    const target = scaffold!.students[0]!;
    await page.goto("/students");
    const panel = await openAssistant(page);
    await ask(page, "Fix a misspelt surname");
    const card = panel.getByRole("region", { name: "Correct student records" });
    await card.getByRole("textbox", { name: /Find a student/ }).fill(target.admissionNumber);
    await card.getByRole("button", { name: new RegExp(target.admissionNumber) }).click();
    const lastName = card.getByRole("textbox", { name: /New last name/ });
    await lastName.fill(`${target.lastName}x`);
    await card.getByRole("button", { name: /^Show the server['’]s before and after$/ }).click();
    await expect(card.getByText("Awaiting your confirmation")).toBeVisible();
    await expect(card.getByText(`${target.lastName}x`)).toBeVisible();
    // Someone else edits the same field: the reviewed preview is now stale.
    expect((await admin.api.patch(`students/${target.id}`, { data: { lastName: `${target.lastName}y` } })).ok()).toBe(true);
    await card.getByRole("checkbox", { name: /I checked the before and after/ }).check();
    await card.getByRole("button", { name: "Confirm corrections" }).click();
    await expect(card.getByText("Records changed")).toBeVisible();
    await card.getByRole("button", { name: "Refresh with current records" }).click();
    await expect(card.getByText(`${target.lastName}y`)).toBeVisible();
    await card.getByRole("checkbox", { name: /I checked the before and after/ }).check();
    await card.getByRole("button", { name: "Confirm corrections" }).click();
    await expect(card.getByText(/Applied: 1 record corrected/)).toBeVisible();
    const after = await withTenant(admin.schoolId, (db) => db.student.findUniqueOrThrow({ where: { id: target.id } }));
    expect(after.lastName).toBe(`${target.lastName}x`);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("signing out clears the conversation", async ({ browser }) => {
  const { admin, page } = await setup(browser, ALL_ON, false);
  try {
    await page.goto("/dashboard");
    const panel = await openAssistant(page);
    await ask(page, "How do I set up term dates?");
    await expect(panel.getByText("How do I set up term dates?")).toBeVisible();
    await panel.getByRole("button", { name: "Minimise assistant" }).click();
    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("menuitem", { name: /log out/i }).click();
    await page.waitForURL(/login/);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(/term dates/);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});
