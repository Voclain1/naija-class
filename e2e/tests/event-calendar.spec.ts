import { expect, test, type Page } from "@playwright/test";

import { defaultCalendarWindow, type ManagedNationalEventDto } from "@school-kit/types";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian, PORTAL_BASE_URL, type PortalGuardian } from "../fixtures/guardian.js";

// Phase 8 / CP1 — Event Calendar, the real end-to-end path.
// Plan-first: docs/modules/phase-8.md §15.4 item 6.
//
// Everything a person does here goes through the UI: the owner creates the
// event and hides the holiday by clicking, and the guardian reads the portal
// in a browser. The API is used only to discover which public holiday falls in
// the current window (the test must not hard-code a date that rots).
//
// Two schools, on purpose. The claims are:
//   1. an event an admin creates is what that school's guardian sees;
//   2. a hidden public holiday disappears for that school's guardian;
//   3. neither of those crosses to another school — the second school's
//      guardian sees no trace of the event, and still sees the holiday.

const SHOTS = "test-results/event-calendar";

async function signIn(page: Page, guardian: PortalGuardian): Promise<void> {
  await page.goto(`${PORTAL_BASE_URL}/login`);
  await page.getByLabel("Email").fill(guardian.email);
  await page.getByLabel("Password", { exact: true }).fill(guardian.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
}

test("admin creates an event and hides a holiday; their guardian sees exactly that, and another school sees neither", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const other = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const eventTitle = `Inter-house sports ${suffix}`;

  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const otherGuardian = await createPortalGuardian(other.api, { suffix: `${suffix}-o`, schoolId: other.schoolId });

  // Pick a public holiday inside the same default window every surface uses,
  // whose name appears once in that window (so "not visible" is unambiguous).
  const w = defaultCalendarWindow();
  const nationalRes = await admin.api.get(`calendar/national-events?from=${w.from}&to=${w.to}`);
  expect(nationalRes.ok(), await nationalRes.text()).toBe(true);
  const national = (await nationalRes.json()) as ManagedNationalEventDto[];
  const holiday = national.find((n) => national.filter((m) => m.name === n.name).length === 1);
  expect(holiday, "a uniquely named public holiday must fall inside the default window").toBeDefined();
  const holidayName = holiday!.name;

  const guardianContext = await browser.newContext();
  const guardianPage = await guardianContext.newPage();
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();

  try {
    // ---- 1. The owner creates an event through the UI -------------------
    await admin.page.goto("/events");
    await expect(admin.page.getByRole("heading", { name: "Event Calendar", level: 1 })).toBeVisible();
    await admin.page.getByRole("button", { name: "Add event" }).click();

    const dialog = admin.page.getByRole("dialog");
    // D25 — the visibility notice is shown BEFORE publishing.
    await expect(dialog.getByText("Everyone at your school — staff, parents and students — will see this event.")).toBeVisible();
    await dialog.getByLabel("Title").fill(eventTitle);
    await dialog.getByLabel("Category").selectOption("EVENT");
    await dialog.getByLabel("Details (optional)").fill("Bring white canvas shoes.");
    await admin.page.screenshot({ path: `${SHOTS}/1-admin-add-event.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Add event" }).click();
    await expect(dialog).toHaveCount(0);

    // It is on the merged calendar AND in the management list.
    await expect(admin.page.getByText(eventTitle)).toHaveCount(2);

    // ---- 2. The owner hides a public holiday through the UI -------------
    await admin.page.getByRole("button", { name: `Hide ${holidayName}` }).click();
    await expect(admin.page.getByRole("button", { name: `Show ${holidayName}` })).toBeVisible();
    // exact: the success toast ("… is hidden from your school's calendar") matches a substring search too.
    await expect(admin.page.getByText("Hidden from your school", { exact: true })).toBeVisible();
    await admin.page.screenshot({ path: `${SHOTS}/2-admin-after-hide.png`, fullPage: true });

    // ---- 3. This school's guardian sees the event, not the hidden holiday
    await signIn(guardianPage, guardian);
    await guardianPage.getByRole("link", { name: "School calendar →" }).click();
    await expect(guardianPage.getByRole("heading", { name: "School calendar" })).toBeVisible();
    await expect(guardianPage.getByText(eventTitle)).toBeVisible();
    await expect(guardianPage.getByText("Bring white canvas shoes.")).toBeVisible();
    await expect(guardianPage.getByText(holidayName, { exact: true })).toHaveCount(0);
    await guardianPage.screenshot({ path: `${SHOTS}/3-guardian-calendar.png`, fullPage: true });
    await guardianPage.setViewportSize({ width: 390, height: 844 });
    await guardianPage.screenshot({ path: `${SHOTS}/3b-guardian-calendar-phone.png`, fullPage: true });

    // ---- 4. Another school's guardian: no event, holiday still there -----
    await signIn(otherPage, otherGuardian);
    await otherPage.goto(`${PORTAL_BASE_URL}/calendar`);
    await expect(otherPage.getByRole("heading", { name: "School calendar" })).toBeVisible();
    await expect(otherPage.getByText(holidayName, { exact: true })).toBeVisible();
    await expect(otherPage.getByText(eventTitle)).toHaveCount(0);
    await otherPage.screenshot({ path: `${SHOTS}/4-other-school-guardian.png`, fullPage: true });

    // ---- 5. Unhide restores it for this school's guardian ----------------
    await admin.page.getByRole("button", { name: `Show ${holidayName}` }).click();
    await expect(admin.page.getByRole("button", { name: `Hide ${holidayName}` })).toBeVisible();
    await guardianPage.reload();
    await expect(guardianPage.getByText(holidayName, { exact: true })).toBeVisible();
  } finally {
    await guardianContext.close();
    await otherContext.close();
    await admin.context.close();
    await admin.api.dispose();
    await other.context.close();
    await other.api.dispose();
  }
});
