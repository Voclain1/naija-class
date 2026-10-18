import { expect, test } from "@playwright/test";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP8.1 — private messaging (docs/modules/phase-9.md §17.8), in a
// real browser against a throwaway school: a parent writes from the portal to
// the school admin about their child; the admin reads it in the web inbox and
// replies; the parent sees the reply signed by who answered, and "Seen".

test("a parent writes to the school admin; the admin replies; the parent reads it", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const parentContext = await browser.newContext();

  try {
    // 1. The parent writes from the portal.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.getByRole("link", { name: /^Messages/ }).click();
    await expect(parent.getByRole("heading", { name: "Messages" })).toBeVisible({ timeout: 60_000 });
    await parent.getByRole("link", { name: "Write a message" }).click();
    const form = parent.getByRole("form", { name: "New message" });
    await form.getByLabel("About").selectOption({ label: `${guardian.studentFirstName} Adeleke` });
    await form.getByRole("radio", { name: "School admin" }).check();
    await form.getByLabel("Subject").fill(`Uniform size ${suffix}`);
    await form.getByLabel("Message").fill("Good morning. Which size of uniform should we buy?");
    await form.getByRole("button", { name: "Send" }).click();
    await expect(parent.getByRole("heading", { name: `Uniform size ${suffix}` })).toBeVisible();
    await expect(parent.getByText("With School admin · about Chidinma Adeleke")).toBeVisible();

    // 2. The admin reads it in the inbox and replies.
    const page = admin.page;
    await page.goto("/messages");
    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
    await page.getByText(`Uniform size ${suffix}`).click();
    await expect(page.getByText("Good morning. Which size of uniform should we buy?")).toBeVisible();
    await expect(page.getByText(/Ngozi Adeleke \(Mother\)/)).toBeVisible();
    await page.getByLabel("Reply").fill("Size 8 for her class. The shop opens at 8am.");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Size 8 for her class. The shop opens at 8am.")).toBeVisible();

    // 3. The parent sees the reply, signed by who answered, and "Seen".
    await parent.reload();
    await expect(parent.getByText("Size 8 for her class. The shop opens at 8am.")).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText(/, School admin ·/)).toBeVisible();
    await expect(parent.getByText("Seen", { exact: true })).toBeVisible();

    // 4. Settings → Messaging lists the staff to appoint.
    await page.goto("/settings/messaging");
    await expect(page.getByRole("heading", { name: "Principal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save messaging roles" })).toBeVisible();
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});

// Phase 9 / CP8.2 — a photo on a message, a safeguarding word that flags the
// conversation for the admins (never blocking it), clearing the flag, and the
// parent's own "Report this conversation".
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("a photo, a safeguarding flag the admin clears, and a parent's report", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const parentContext = await browser.newContext();

  try {
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/messages/new`);
    const form = parent.getByRole("form", { name: "New message" });
    await form.getByLabel("About").selectOption({ label: `${guardian.studentFirstName} Adeleke` });
    await form.getByRole("radio", { name: /office$/ }).check();
    await form.getByLabel("Subject").fill(`Bus ${suffix}`);
    await form.getByLabel("Message").fill("She says an older pupil beat her on the bus.");
    await form.locator('input[type="file"]').setInputFiles({ name: "bruise.png", mimeType: "image/png", buffer: PNG_1PX });
    await expect(form.getByText("bruise.png")).toBeVisible({ timeout: 30_000 });
    await form.getByRole("button", { name: "Send" }).click();
    await expect(parent.getByRole("heading", { name: `Bus ${suffix}` })).toBeVisible();
    await expect(parent.getByRole("img", { name: "Photo 1" })).toBeVisible();
    // Never blocked, and the family is not told the school's system flagged it.
    await expect(parent.getByText("She says an older pupil beat her on the bus.")).toBeVisible();
    await expect(parent.getByRole("button", { name: "Report this conversation" })).toBeVisible();

    // The admin finds it under Flagged, with the word marked.
    const page = admin.page;
    await page.goto("/messages?box=FLAGGED");
    await expect(page.getByRole("button", { name: "Flagged", pressed: true })).toBeVisible();
    await page.getByText(`Bus ${suffix}`).click();
    await expect(page.getByText(/Flagged: Safeguarding words/)).toBeVisible();
    await expect(page.getByText("Safeguarding word", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();
    await page.getByRole("button", { name: "Clear flag" }).click();
    await expect(page.getByText(/Flagged: Safeguarding words/)).toHaveCount(0);

    // The parent reports it.
    await parent.getByRole("button", { name: "Report this conversation" }).click();
    await parent.getByLabel("What worries you? (optional)").fill("Nobody has called me back.");
    await parent.getByRole("button", { name: "Report", exact: true }).click();
    await expect(parent.getByText("You reported this conversation. The school's owner and admins can read it.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Flagged: Reported by the parent/)).toBeVisible();
    await expect(page.getByText("“Nobody has called me back.”")).toBeVisible();
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
