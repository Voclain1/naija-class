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
