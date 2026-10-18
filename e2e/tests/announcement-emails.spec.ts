import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP8.3 — email broadcasts for announcements (docs/modules/
// phase-9.md §17.11), in a real browser: the admin sends an announcement with
// "Also email families" and the outbox shows how the email went; a parent
// opens the unsubscribe link from an email, unsubscribes and undoes it; and
// switches announcement emails in the portal's Settings.

function unsubscribeToken(schoolId: string, email: string): string {
  const key = process.env.RESULT_PIN_HMAC_KEY?.trim() || "school-kit-dev-result-pin-key-not-for-production";
  return createHmac("sha256", key).update(`email-unsubscribe:v1:${schoolId}:${email.toLowerCase()}`).digest("hex");
}

test("also email families, the outbox counts, the unsubscribe link and the portal switch", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const parentContext = await browser.newContext();

  try {
    // 1. The admin composes with "Also email families".
    const page = admin.page;
    await page.goto("/announcements");
    await page.getByLabel("Title").fill(`Sports day ${suffix}`);
    await page.getByLabel("Message").fill("Sports day is on Friday. Children wear house colours.");
    await page.getByLabel("Who sees it").selectOption("PARENTS");
    await page.getByRole("checkbox", { name: /Also email families/ }).check();
    await expect(page.getByText(/will be emailed/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Today's limit on your plan: \d+ of \d+ left\./)).toBeVisible();
    page.once("dialog", (d) => {
      expect(d.message()).toMatch(/An email cannot be withdrawn|nobody will be emailed/);
      void d.accept();
    });
    await page.getByRole("button", { name: "Send announcement" }).click();
    await expect(page.getByText("Sent.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const item = page.getByRole("listitem").filter({ hasText: `Sports day ${suffix}` });
    await expect(item.getByLabel("Email to families")).toBeVisible({ timeout: 30_000 });
    await expect(item.getByText(/emails? sent/)).toBeVisible();

    // Settings → Plan names the daily limit.
    await page.goto("/settings/plan");
    await expect(page.getByRole("heading", { name: "Announcement emails" })).toBeVisible();
    await expect(page.getByText(/announcement\s+emails a day/)).toBeVisible();

    // 2. The parent opens the unsubscribe link from an email (no sign-in).
    const { basePrisma } = await import("@school-kit/db");
    const school = await basePrisma.school.findUniqueOrThrow({ where: { id: admin.schoolId }, select: { slug: true, name: true } });
    const qs = new URLSearchParams({ s: school.slug, e: guardian.email, t: unsubscribeToken(admin.schoolId, guardian.email) }).toString();
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/email/unsubscribe?${qs}`);
    await expect(parent.getByText(`You get announcement emails from ${school.name}`)).toBeVisible({ timeout: 60_000 });
    await parent.getByRole("button", { name: "Stop announcement emails" }).click();
    await expect(parent.getByText(`You will no longer get announcement emails from ${school.name}`)).toBeVisible();
    await parent.getByRole("button", { name: /Undo/ }).click();
    await expect(parent.getByText(`You get announcement emails from ${school.name}`)).toBeVisible();

    // A tampered link is refused.
    await parent.goto(`${PORTAL_BASE_URL}/email/unsubscribe?${qs.replace(/t=[0-9a-f]{4}/, "t=0000")}`);
    await expect(parent.getByText("This link is not valid.", { exact: false })).toBeVisible();

    // 3. Signed in, the parent switches announcement emails in Settings.
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.getByRole("link", { name: "Settings →" }).click();
    const box = parent.getByRole("checkbox", { name: /Email me the school's announcements/ });
    await expect(box).toBeChecked({ timeout: 30_000 });
    await box.click();
    await expect(box).not.toBeChecked();
    await parent.reload();
    await expect(parent.getByRole("checkbox", { name: /Email me the school's announcements/ })).not.toBeChecked({ timeout: 30_000 });
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
